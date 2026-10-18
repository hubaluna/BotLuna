import {DatabaseSync} from 'node:sqlite';
export class D1 {
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');this.queries=0;}
 prepare(sql){return new Statement(this,sql,[]);}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(s.execute());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
 close(){this.sqlite.close();}
}
class Statement {
 constructor(db,sql,args){this.db=db;this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.db,this.sql,args);}
 execute(){this.db.queries++;const s=this.db.sqlite.prepare(this.sql);if(s.columns().length){const rows=s.all(...this.args);return {success:true,results:rows,meta:{changes:this.db.sqlite.prepare('SELECT changes() n').get().n}};}const result=s.run(...this.args);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
 async first(column){const r=this.execute().results[0]||null;return column&&r?r[column]:r;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
