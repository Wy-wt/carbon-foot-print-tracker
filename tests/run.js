/* =========================================================
   tests/run.js · 命令行版检查（共 27 项）
   ---------------------------------------------------------
   用法：  node tests/run.js
   组成：  tests/cases.js 里的 24 项（计算、边界、建议、模拟器…）
          + 本文件里的 3 项"文件检查"（要读 index.html，只能在命令行跑）
   原理：  用 Node 的 vm 造一个假的 window，把 factors.js / engine.js
          原样加载进来，不改一行业务代码。
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TESTS_DIR = __dirname;
const ROOT = path.join(TESTS_DIR, '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');

/* ---------- 1. 造一个"假浏览器"，把业务代码原样装进去 ---------- */
const sandbox = { window: {}, console: console };
vm.createContext(sandbox);
['factors.js', 'engine.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), sandbox, { filename: file });
});
vm.runInContext('var CF = window.CF;', sandbox);
vm.runInContext(fs.readFileSync(path.join(TESTS_DIR, 'cases.js'), 'utf8'), sandbox, { filename: 'cases.js' });

const CF = sandbox.window.CF;
const CASES = sandbox.window.CF_CASES;

/* ---------- 2. 迷你断言框架 ---------- */
let passed = 0;
const failures = [];

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function runGroup(title, tests) {
  console.log('\n' + title);
  tests.forEach(function (t) {
    try {
      t.fn();
      passed++;
      console.log('  \u2713 ' + t.name);
    } catch (err) {
      failures.push({ name: t.name, message: err.message });
      console.log('  \u2717 ' + t.name);
      console.log('      ' + err.message);
    }
  });
}

/* ---------- 3. 先跑共用的 24 项 ---------- */
CASES.groups.forEach(function (g) {
  runGroup(g.title, g.tests);
});

/* ---------- 4. 再加 3 项文件检查（网页版跑不了，这里补上） ---------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

runGroup('七、静态产物自查（只在命令行版执行）', [
  {
    name: 'index.html 引用的 5 个资源文件都存在',
    fn: function () {
      const refs = [];
      html.replace(/(?:href|src)="(assets\/[^"]+)"/g, function (m, p) { refs.push(p); return m; });
      ok(refs.length === 5, '应引用 5 个资源，实际 ' + refs.length + ' 个：' + refs.join(', '));
      refs.forEach(function (rel) {
        ok(fs.existsSync(path.join(ROOT, rel)), '缺少文件：' + rel);
      });
    }
  },
  {
    name: '没有写死的绝对路径（否则部署到子目录会 404）',
    fn: function () {
      ok(!/["']\/assets\//.test(html), '发现以 / 开头的绝对路径，部署到子路径会失效');
    }
  },
  {
    name: '页面上的系数表与代码里的数值一致',
    fn: function () {
      const expected = [
        String(CF.ELEC_FACTOR),
        CF.FACTORS.transport.car.factor.toFixed(2),
        CF.FACTORS.transport.bus.factor.toFixed(3),
        CF.FACTORS.transport.metro.factor.toFixed(3),
        String(CF.DIET.takeoutPerMeal)
      ];
      // 用"数字边界"匹配，避免 0.5 匹配到 0.5703 里的前三位（断言写太松的经典坑）
      function hasNumber(text, num) {
        const esc = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(?<![\\d.])' + esc + '(?![\\d.])').test(text);
      }
      expected.forEach(function (v) {
        ok(hasNumber(html, v), '页面上找不到系数 ' + v + '，文档和代码可能已经不一致');
      });
    }
  }
]);

/* ---------- 5. 汇总 ---------- */
console.log('\n' + '\u2500'.repeat(56));
if (failures.length === 0) {
  console.log('全部通过：' + passed + ' 项\n');
  process.exit(0);
} else {
  console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项：');
  failures.forEach(function (f) { console.log('  \u00b7 ' + f.name + ' \u2014\u2014 ' + f.message); });
  console.log('');
  process.exit(1);
}
