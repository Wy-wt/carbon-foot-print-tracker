# 自动化测试怎么写（本项目的现成方案）

> 一句话：**计算逻辑用 Node 单元测试（27 项，零依赖），页面交互用 Playwright 端到端，部署后用一条 curl 冒烟。**
> 三层各管一件事，谁都不用装一堆东西。

---

## 两种跑法，看你是谁

同一份测试（`cases.js`），有两个入口，结果不会不一致：

| 谁用 | 入口 | 项数 | 需要装什么 |
|---|---|---|---|
| B1（改系数的人）、C2（发布前把关） | 命令行：`node tests/run.js` | **27 项**（含 3 项文件检查） | Node.js |
| **D2（写测试报告的人）** | **网页版：双击 `tests/runner.html`** | **24 项** | **不用装任何东西** |

### D2 的三步（不需要任何基础）

1. 打开项目文件夹，进 `tests`，双击 `runner.html`
2. 等 1 秒，页面显示「全部通过：24 项」（绿色大勾）
3. 截图；需要文字时点「复制结果」，直接粘进报告

如果出现红色 ✗，把红的那几条截图发给 B1，他会看「期望 X，实际 Y」定位是哪条系数错了。

> 网页版少了 3 项「文件检查」（资源是否齐全、有没有写死绝对路径、页面系数与代码是否一致）——
> 那三项要读文件，浏览器里做不到，只在命令行版执行。所以命令行 27 项、网页 24 项，**这不是少测了，是分工不同**。

---

## 第一层：单元测试（已实现，直接跑）

```bash
node tests/run.js
```

不需要 `npm install`，不需要浏览器。原理是拿 Node 的 `vm` 造一个假的 `window`，把 `assets/js/factors.js` 和 `assets/js/engine.js` **原样加载**进来，然后直接对计算结果做断言 —— 业务代码一行都不用改。

```
一、系数表体检
  ✓ 电网因子是正数
  ✓ 每条基准线数值正确
  ...
全部通过：27 项
```

现在覆盖了七组：

| 组 | 测什么 |
|---|---|
| 系数表体检 | 有没有 0 或负数、基准线是不是 8.0/4.7/2.0、等级阈值是否递增 |
| 计算引擎 | 三组手算对照、总量=分项之和、人口分摊倍数、估算模式 |
| 输入健壮性 | 负数 / NaN / 空值 / 9999 km / 人口 0 和 99 都不许算出 NaN |
| 等级边界 | 2000 / 3500 / 5000 / 8000 恰好落在哪一档 |
| 减排建议 | 条数 3~5、降序排列、**每条不超过所属分项总量**、合计不超过总量、重点标记最多 1 个 |
| 模拟器 | 改通勤方式后总量必然下降，且减量等于公式算出来的值 |
| 静态产物 | 5 个资源文件都在、没有绝对路径、页面系数表与代码一致 |

### 加一条新测试长什么样

```js
test('步行通勤时出行分项为 0', function () {
  const r = CF.compute(baseInput({ transportMode: 'walk', commuteKm: 100 }));
  near(r.transport, 0);          // near(实际值, 期望值, 容差)
});
```

就三件事：**造输入 → 调 `CF.compute` → 断言输出**。断言失败会打印「期望 X，实际 Y」，`node` 退出码非 0，CI 直接红。

---

## 第二层：端到端测试（页面交互，可选但建议做）

单元测试保证"算得对"，但不能保证"点得动"。这一层用 [Playwright](https://playwright.dev) 开一个真浏览器，模拟用户操作。

```bash
npm init -y
npm i -D @playwright/test
npx playwright install chromium
npx playwright test
```

`tests/e2e.spec.js` 示例（可直接用）：

```js
const { test, expect } = require('@playwright/test');

test('完整走一遍：填表 → 出结果 → 拖模拟器 → 存历史', async ({ page }) => {
  await page.goto('http://127.0.0.1:8000/');

  await page.click('[data-nav="form"]');
  await page.fill('#commuteKmNum', '100');
  await page.fill('#monthlyKwhNum', '320');
  await page.click('input[name="mode"][value="car"]');
  await page.click('#btnCalc');

  // 结果页出现，且数字不是 0
  const total = await page.textContent('#resTotal');
  expect(parseFloat(total)).toBeGreaterThan(1);

  // 两张图都渲染出来了（ECharts 用 canvas）
  await expect(page.locator('#donutChart canvas')).toHaveCount(1);
  await expect(page.locator('#barChart canvas')).toHaveCount(1);

  // 模拟器：把通勤比例拖到 100%，数字应该变小
  const before = await page.textContent('#simTotal');
  await page.locator('[data-sim-input="transit"]').fill('100');
  const after = await page.textContent('#simTotal');
  expect(parseFloat(after)).toBeLessThan(parseFloat(before));

  // 存历史 → 抽屉里有 1 条
  await page.click('#btnSaveHistory');
  await page.click('#btnHistory');
  await expect(page.locator('.hist-item')).toHaveCount(1);
});

test('手机尺寸下不出现横向滚动条', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8000/');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

要点：
- 跑之前先 `python -m http.server 8000`，E2E 打的是本地服务器不是 `file://`；
- 断言尽量用**可读的文本/数量**（`#resTotal` 的数值、`.sug-item` 的条数），少依赖样式；
- 图表断言只查 `canvas` 存在，不比对像素，否则一改配色就全红。

---

## 第三层：上线冒烟测试（部署后跑一次）

部署最容易出的问题不是逻辑，是**资源 404**（只传了 `index.html`、zip 路径被压成反斜杠）。一条命令就能验：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://你的站点/index.html
curl -s -o /dev/null -w "%{http_code}\n" https://你的站点/assets/css/style.css
```

或者用现成的一行 PowerShell 查全部关键路径：

```powershell
$base = "https://你的站点/"
"", "index.html", "assets/css/style.css", "assets/js/app.js" |
  ForEach-Object { "{0,-24} {1}" -f $_, (curl.exe -s -o NUL -w "%{http_code}" --max-time 10 ($base + $_)) }
```

四个都是 200 才算上线成功。

---

## 什么时候跑什么

| 时机 | 跑哪层 | 耗时 |
|---|---|---|
| 改了系数 / 公式 / 建议逻辑 | 第一层 | < 1 秒 |
| 改了页面结构、样式、交互 | 第二层 | ~30 秒 |
| 每次部署完 | 第三层 | ~5 秒 |
| 每次 push（可选） | 第一层 + 第三层 | < 10 秒 |

想自动化到 CI：在仓库加 `.github/workflows/test.yml`，`on: [push, pull_request]`，步骤就是 `actions/checkout` → `actions/setup-node` → `node tests/run.js`。这一步做出来，答辩时"你们怎么做质量保证"就有硬东西可讲了。

---

## 这套测试已经抓到的两个真问题

第一次跑就红了 2 项，不是形式主义：

1. **兜底建议越界**：用户"出行"排放为 0 时，兜底建议还会给出"3 公里内步行"减 93.6 kg —— 减的比排的还多。"每条建议不超过所属分项"这条断言直接抓出来了，已修。
2. **模拟器改了不该改的项**：滑块写的是「通勤改为公共交通」，但代码把「其他出行」也一起按新系数算了，减排量被高估 174.72 kg。修法是给引擎加 `otherFactor`，通勤和其他出行分开取系数。

这两条都属于"肉眼看不出、答辩会被问穿"的问题，正是自动化测试的价值。
