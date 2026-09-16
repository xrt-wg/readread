// 临时探针：验证旧/新切分正则（仅用于本次审核，可删除）
const OLD = /[^.!?]+(?:[.!?]+(?:\s|$))?/g;
const NEW = /[^.!?]+(?:[.!?]+["'”’)\]]*(?:\s|$))?/g;

function split(re, text) {
  const s = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[0].trim();
    if (t) s.push(t);
  }
  return s;
}

const ELLIPSIS = '…';
const norm = (t) => t.replace(/\.{2,}/g, ELLIPSIS);

const cases = [
  ['executive 句号在引号内', '… or make lots of money by becoming an "executive." Now you can make lots of money …'],
  ["直引号 'fine.'", "He said that's 'fine.' Then"],
  ['右括号 Fig 1.)', '(see Fig 1.) Next'],
  ['直引号 "done."', 'quote "done." then'],
  ['普通句尾', 'It works fine. Next'],
  ['句号在引号外 done".', 'He said "done". Then'],
  ['嵌套闭合 "yes.")', '(He said "yes.") Next'],
  ['闭合符后无空格 ."Next', '…becoming an "executive."Next …'],
  ['所有格撇号 mid-word', "the kids' toys. Next"],
  ['缩写 e.g.', 'e.g. something else. Then'],
  ['引号内省略号 ... do it."', "He said \"I'll ... do it.\" Then"],
];

for (const [name, text] of cases) {
  const n = norm(text);
  console.log('=== ' + name + ' ===');
  console.log('  OLD:', JSON.stringify(split(OLD, n)));
  console.log('  NEW:', JSON.stringify(split(NEW, n)));
}
