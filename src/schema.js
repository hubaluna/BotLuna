export const SCHEMA = [
`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, price INTEGER NOT NULL CHECK(price>0), active INTEGER NOT NULL CHECK(active IN(0,1)), data TEXT NOT NULL CHECK(json_valid(data)))`,
`CREATE TABLE IF NOT EXISTS stock (variant TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(quantity>=-1))`,
`CREATE TABLE IF NOT EXISTS carts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, variant TEXT NOT NULL REFERENCES stock(variant), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10), UNIQUE(user_id,variant))`,
`CREATE TABLE IF NOT EXISTS sessions (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, last_update INTEGER NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS mutations (operation TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS assets (key TEXT PRIMARY KEY, file_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('photo','document')))`,
`CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, state TEXT NOT NULL, lock_until INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN('demo','live')),
 status TEXT NOT NULL DEFAULT 'new', items TEXT NOT NULL CHECK(json_valid(items)),
 customer TEXT NOT NULL CHECK(json_valid(customer)), package_name TEXT NOT NULL,
 goods_total INTEGER NOT NULL, packaging_total INTEGER NOT NULL CHECK(packaging_total>=0),
 total INTEGER NOT NULL CHECK(total=goods_total+packaging_total), admin_targets TEXT NOT NULL, store_version TEXT NOT NULL,
 tracking TEXT NOT NULL DEFAULT '')`,
`CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id,id)`,
`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), status TEXT NOT NULL, created_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, order_id INTEGER NOT NULL REFERENCES orders(id), kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_try INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0)`,
`CREATE TRIGGER IF NOT EXISTS cart_insert_check BEFORE INSERT ON carts BEGIN
 SELECT CASE WHEN NEW.quantity NOT BETWEEN 1 AND 10 THEN RAISE(ABORT,'CART_LIMIT') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stock WHERE variant=NEW.variant AND (quantity=-1 OR quantity>=NEW.quantity)) THEN RAISE(ABORT,'STOCK_CHANGED') END;
 SELECT CASE WHEN COALESCE((SELECT SUM(quantity) FROM carts WHERE user_id=NEW.user_id AND variant!=NEW.variant),0)+NEW.quantity > COALESCE((SELECT json_extract(value,'$.max_cart_units') FROM settings WHERE key='store'),20) THEN RAISE(ABORT,'CART_LIMIT') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM carts WHERE user_id=NEW.user_id AND variant!=NEW.variant)>=COALESCE((SELECT json_extract(value,'$.max_cart_lines') FROM settings WHERE key='store'),10) THEN RAISE(ABORT,'CART_LIMIT') END;
 END`,
`CREATE TRIGGER IF NOT EXISTS cart_update_check BEFORE UPDATE ON carts BEGIN
 SELECT CASE WHEN NEW.quantity NOT BETWEEN 1 AND 10 THEN RAISE(ABORT,'CART_LIMIT') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stock WHERE variant=NEW.variant AND (quantity=-1 OR quantity>=NEW.quantity)) THEN RAISE(ABORT,'STOCK_CHANGED') END;
 SELECT CASE WHEN COALESCE((SELECT SUM(quantity) FROM carts WHERE user_id=NEW.user_id AND variant!=NEW.variant),0)+NEW.quantity > COALESCE((SELECT json_extract(value,'$.max_cart_units') FROM settings WHERE key='store'),20) THEN RAISE(ABORT,'CART_LIMIT') END;
 END`,
`CREATE TRIGGER IF NOT EXISTS order_insert_check BEFORE INSERT ON orders
 WHEN NOT EXISTS(SELECT 1 FROM orders WHERE token=NEW.token) BEGIN
 SELECT CASE WHEN json_array_length(NEW.items) NOT BETWEEN 1 AND 10 THEN RAISE(ABORT,'CART_CHANGED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.items) j LEFT JOIN stock s ON s.variant=json_extract(j.value,'$.variant') WHERE s.variant IS NULL OR (s.quantity>=0 AND s.quantity<json_extract(j.value,'$.quantity')) OR (s.quantity=-1)!=json_extract(j.value,'$.preorder')) THEN RAISE(ABORT,'STOCK_CHANGED') END;
 SELECT CASE WHEN NEW.store_version!=(SELECT json_extract(value,'$.revision') FROM settings WHERE key='store') THEN RAISE(ABORT,'CONFIG_CHANGED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.items) j LEFT JOIN products p ON p.id=json_extract(j.value,'$.product_id') WHERE p.id IS NULL OR p.active!=1 OR p.price!=json_extract(j.value,'$.unit_price')) THEN RAISE(ABORT,'PRICE_CHANGED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM carts WHERE user_id=NEW.user_id)!=json_array_length(NEW.items) OR EXISTS(SELECT 1 FROM carts c WHERE c.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM json_each(NEW.items) j WHERE json_extract(j.value,'$.variant')=c.variant AND json_extract(j.value,'$.quantity')=c.quantity)) THEN RAISE(ABORT,'CART_CHANGED') END;
 SELECT CASE WHEN NEW.goods_total!=(SELECT SUM(json_extract(value,'$.quantity')*json_extract(value,'$.unit_price')) FROM json_each(NEW.items)) THEN RAISE(ABORT,'PRICE_CHANGED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM settings s,json_each(json_extract(s.value,'$.packages')) p WHERE s.key='store' AND json_extract(p.value,'$.id')=json_extract(NEW.customer,'$.package') AND json_extract(p.value,'$.price_uah')=NEW.packaging_total) THEN RAISE(ABORT,'PRICE_CHANGED') END;
 END`,
`CREATE TRIGGER IF NOT EXISTS order_after_insert AFTER INSERT ON orders BEGIN
 UPDATE stock SET quantity=quantity-(SELECT json_extract(value,'$.quantity') FROM json_each(NEW.items) WHERE json_extract(value,'$.variant')=stock.variant) WHERE quantity>=0 AND variant IN(SELECT json_extract(value,'$.variant') FROM json_each(NEW.items));
 DELETE FROM carts WHERE user_id=NEW.user_id;
 DELETE FROM sessions WHERE user_id=NEW.user_id;
 INSERT INTO events(order_id,status,created_at) VALUES(NEW.id,'new',NEW.created_at);
 INSERT INTO outbox(chat_id,order_id,kind) VALUES(NEW.user_id,NEW.id,'buyer_new');
 INSERT INTO outbox(chat_id,order_id,kind) SELECT CAST(value AS INTEGER),NEW.id,'admin_new' FROM json_each(NEW.admin_targets);
 END`,
`CREATE TRIGGER IF NOT EXISTS status_after_update AFTER UPDATE OF status ON orders WHEN OLD.status!=NEW.status BEGIN
 UPDATE stock SET quantity=quantity+(SELECT json_extract(value,'$.quantity') FROM json_each(NEW.items) WHERE json_extract(value,'$.variant')=stock.variant AND json_extract(value,'$.preorder')=0) WHERE NEW.status='cancelled' AND OLD.status!='cancelled' AND quantity>=0 AND variant IN(SELECT json_extract(value,'$.variant') FROM json_each(NEW.items) WHERE json_extract(value,'$.preorder')=0);
 INSERT INTO events(order_id,status,created_at) VALUES(NEW.id,NEW.status,strftime('%Y-%m-%dT%H:%M:%SZ','now'));
 INSERT INTO outbox(chat_id,order_id,kind) VALUES(NEW.user_id,NEW.id,'buyer_status');
 INSERT INTO outbox(chat_id,order_id,kind) SELECT CAST(value AS INTEGER),NEW.id,'admin_status' FROM json_each(NEW.admin_targets) WHERE NEW.status='cancelled';
 END`
];

export const COMMERCE_SCHEMA=[
`CREATE TABLE IF NOT EXISTS buyer_notifications(order_id INTEGER NOT NULL REFERENCES orders(id),topic TEXT NOT NULL,signature TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',lock_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(order_id,topic,signature))`,
`CREATE TABLE IF NOT EXISTS customers(user_id INTEGER PRIMARY KEY,phone TEXT NOT NULL DEFAULT '',full_name TEXT NOT NULL DEFAULT '',verified_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,last_seen TEXT NOT NULL,marketing INTEGER NOT NULL DEFAULT 0 CHECK(marketing IN(0,1)),marketing_at TEXT NOT NULL DEFAULT '',blocked INTEGER NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS consent_events(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,topic TEXT NOT NULL,accepted INTEGER NOT NULL,created_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS campaigns(id INTEGER PRIMARY KEY,text TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,actor INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS campaign_deliveries(campaign_id INTEGER NOT NULL REFERENCES campaigns(id),user_id INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,lock_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(campaign_id,user_id))`,
`CREATE TABLE IF NOT EXISTS order_money(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),kind TEXT NOT NULL CHECK(kind IN('receipt','refund')),amount INTEGER NOT NULL CHECK(amount>0),reference TEXT NOT NULL UNIQUE,source TEXT NOT NULL,created_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,mode TEXT NOT NULL DEFAULT 'live' CHECK(mode IN('demo','live')),amount INTEGER NOT NULL CHECK(amount>0),category TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,reference TEXT NOT NULL UNIQUE)`,
`CREATE TABLE IF NOT EXISTS payment_invoices(order_id INTEGER PRIMARY KEY REFERENCES orders(id),invoice_id TEXT UNIQUE,page_url TEXT NOT NULL DEFAULT '',amount INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'creating',created_at TEXT NOT NULL,checked_at INTEGER NOT NULL DEFAULT 0,reference TEXT NOT NULL UNIQUE)`,
`CREATE TRIGGER IF NOT EXISTS money_check BEFORE INSERT ON order_money WHEN NOT EXISTS(SELECT 1 FROM order_money WHERE reference=NEW.reference) BEGIN
 SELECT CASE WHEN NEW.kind='receipt' AND NEW.amount+(SELECT COALESCE(SUM(amount),0) FROM order_money WHERE order_id=NEW.order_id AND kind='receipt')>(SELECT total*100 FROM orders WHERE id=NEW.order_id) THEN RAISE(ABORT,'PAYMENT_LIMIT') END;
 SELECT CASE WHEN NEW.kind='refund' AND NEW.amount+(SELECT COALESCE(SUM(amount),0) FROM order_money WHERE order_id=NEW.order_id AND kind='refund')>(SELECT COALESCE(SUM(amount),0) FROM order_money WHERE order_id=NEW.order_id AND kind='receipt') THEN RAISE(ABORT,'REFUND_LIMIT') END;
END`
];
export async function ensureCommerce(db){
 const version=await db.prepare("SELECT value FROM settings WHERE key='commerce_schema'").first();
 if(version?.value==='2')return;
 const migration=version?.value==='1'?[COMMERCE_SCHEMA[0]]:COMMERCE_SCHEMA;
 await db.batch([...migration.map(q=>db.prepare(q)),db.prepare("INSERT INTO settings VALUES('commerce_schema','2') ON CONFLICT(key) DO UPDATE SET value='2'")]);
}
