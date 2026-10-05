"""Parses the DigitalBurj SME Business Catalogue PDF text (pdftotext -layout) into src/catalogue.json."""
import re, json, sys
txt = open(sys.argv[1]).read()
pages = txt.split('\f')
sectors = []
for pg in pages:
    m = re.search(r'SECTOR (\d{2}) (\d+) CUSTOMER TYPES', pg)
    if not m: continue
    lines = [l.rstrip() for l in pg.split('\n')]
    no, n = int(m.group(1)), int(m.group(2))
    i = next(k for k, l in enumerate(lines) if 'SECTOR' in l and 'CUSTOMER TYPES' in l)
    j = next(k for k, l in enumerate(lines) if l.strip() == 'Suggested first service')
    title = ' '.join(l.strip() for l in lines[i + 1:j] if l.strip())
    def after(label):
        k = next(k for k, l in enumerate(lines) if l.strip() == label); out = []
        for l in lines[k + 1:]:
            if not l.strip(): 
                if out: break
                continue
            out.append(l.strip()); break
        return out[0]
    first = after('Suggested first service')
    buyer = re.sub(r'^Typical buyer:\s*', '', next(l.strip() for l in lines if l.strip().startswith('Typical buyer:')))
    workflow = after('Typical customer workflow')
    align = re.sub(r'^Published vertical alignment:\s*', '', next(l.strip() for l in lines if l.strip().startswith('Published vertical alignment:')))
    t0 = next(k for k, l in enumerate(lines) if l.strip() == 'Business and organisation types')
    t1 = next(k for k, l in enumerate(lines) if k > t0 and (l.strip().startswith('* Named') or l.strip() == 'Additional delivery requirements'))
    items = {}; last = {0: None, 1: None}
    for l in lines[t0 + 1:t1]:
        if not l.strip(): continue
        found = list(re.finditer(r'(\d{2}) (.+?)(?=\s{3,}\d{2} |\s*$)', l))
        if found and l.lstrip()[:2].isdigit():
            for f in found:
                num = int(f.group(1)); name = f.group(2).strip(); star = name.endswith('*')
                name = name.rstrip('*').strip(); items[num] = {'name': name, 'directory': star}; last[0 if f.start() < 45 else 1] = num
        else:  # wrapped continuation
            col = 0 if (len(l) - len(l.lstrip())) < 45 else 1
            if last[col]: items[last[col]]['name'] += ' ' + l.strip()
    req = lines[next(k for k, l in enumerate(lines) if l.strip() == 'Additional delivery requirements') + 1].strip()
    req2 = lines[next(k for k, l in enumerate(lines) if l.strip() == 'Additional delivery requirements') + 2].strip()
    if req2 and not req2.startswith('DigitalBurj SME') and not re.match(r'^\d+ / \d+', req2): req += ' ' + req2
    types = [items[k] for k in sorted(items)]
    assert len(types) == n, (no, len(types), n)
    sectors.append({'no': no, 'name': title, 'firstService': first, 'buyer': buyer, 'workflow': workflow, 'alignment': align, 'types': types, 'requirements': req})
assert len(sectors) == 40 and sum(len(s['types']) for s in sectors) == 746
json.dump(sectors, open('src/catalogue.json', 'w'), indent=1, ensure_ascii=False)
print('ok', len(sectors), sum(len(s['types']) for s in sectors))
