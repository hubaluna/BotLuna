from pathlib import Path
import re,json,gzip

root=Path(__file__).resolve().parent
html=(root/'src/admin.html').read_text()
(root/'src/ui.js').write_text('export const SETUP_HTML = '+json.dumps(html,ensure_ascii=False)+';\n')
files=['defaults.js','schema.js','copy.js','core.js','bot.js','ui.js','worker.js']
parts=['// FORMULOVE Cloudflare Workers + D1. Generated single-file dashboard edition.\n']
for name in files:
    source=(root/'src'/name).read_text()
    source=re.sub(r'^import .*?;\n','',source,flags=re.M)
    source=re.sub(r'\bexport (?=(?:const|class|function|async function)\b)','',source)
    parts.append('// ---- '+name+' ----\n'+source)
result='\n'.join(parts)
(root/'worker.js').write_text(result)
(root/'worker-copy.txt').write_text(result)
print('worker.js:',len(result.encode()),'bytes;',len(gzip.compress(result.encode())),'bytes gzip')
