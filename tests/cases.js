/* =========================================================
   tests/cases.js · 24 项检查（不需要读文件的那部分）
   ---------------------------------------------------------
   同一份测试，两个地方用：
     1. tests/run.js      命令行：node tests/run.js（24 + 3 项文件检查 = 27 项）
     2. tests/runner.html 网页版：双击打开就能看结果（24 项）
   测试只写一遍，两边共用，不会出现“网页版和命令行版结果不一样”。
   ========================================================= */
(function (root) {
  'use strict';

  var groups = [];
  var current = null;

  function group(title) {
    current = { title: title, tests: [] };
    groups.push(current);
  }

  function test(name, fn) {
    current.tests.push({ name: name, fn: fn });
  }

  function ok(cond, msg) {
    if (!cond) throw new Error(msg || '断言失败');
  }

  function near(actual, expected, tolerance, msg) {
    var t = tolerance == null ? 1e-6 : tolerance;
    if (Math.abs(actual - expected) > t) {
      throw new Error((msg ? msg + '：' : '') + '期望 ' + expected + '，实际 ' + actual.toFixed(3));
    }
  }

function baseInput(overrides) {
  return Object.assign({
    transportMode: 'metro',
    commuteKm: 40,
    otherKm: 20,
    elecMode: 'direct',
    monthlyKwh: 240,
    household: 3,
    redMeat: 4,
    takeout: 3,
    dietType: 'balanced',
    clothing: 3000,
    electronics: 2000
  }, overrides || {});
}

group('一、系数表体检');

test('电网因子是正数', function () {
  ok(CF.ELEC_FACTOR > 0, 'ELEC_FACTOR 应大于 0');
});

test('每种出行方式的系数都在 0~1 之间', function () {
  Object.keys(CF.FACTORS.transport).forEach(function (k) {
    const f = CF.FACTORS.transport[k].factor;
    ok(f >= 0 && f <= 1, k + ' 的系数 ' + f + ' 超出合理范围');
  });
});

test('三条基准线正好是全国 8.0 / 全球 4.7 / 巴黎 2.0 吨', function () {
  const map = {};
  CF.BENCHMARKS.forEach(function (b) { map[b.key] = b.value; });
  near(map.national, 8000);
  near(map.global, 4700);
  near(map.paris, 2000);
});

test('等级阈值严格递增，且最后一档不封顶', function () {
  for (let i = 1; i < CF.GRADES.length; i++) {
    ok(CF.GRADES[i].max > CF.GRADES[i - 1].max, '第 ' + i + ' 档阈值没有递增');
  }
  ok(CF.GRADES[CF.GRADES.length - 1].max === Infinity, '最后一档应为 Infinity');
});

test('红肉单次排放 = 150g × 13.3', function () {
  near(CF.DIET.redMeatPerServing, CF.DIET.perMealKg * CF.DIET.redMeatFactor);
});

/* =========================================================
   二、计算引擎：手算对照
   ========================================================= */
group('二、计算引擎（手算对照）');

test('标准输入：总量 = 手算 2092.49 kg', function () {
  // 出行 40*52*0.032 + 20*52*0.032 = 66.56 + 33.28
  // 用电 240*12/3*0.5703          = 547.49
  // 饮食 700 + 4*52*1.995 + 3*52*0.45 = 700 + 414.96 + 70.2
  // 消费 3000*0.06 + 2000*0.04    = 180 + 80
  const r = CF.compute(baseInput());
  near(r.commute, 66.56, 0.01);
  near(r.other, 33.28, 0.01);
  near(r.elec, 547.488, 0.01);
  near(r.foodBase, 700);
  near(r.redMeatKg, 414.96, 0.01);
  near(r.takeoutKg, 70.2, 0.01);
  near(r.consume, 260, 0.01);
  near(r.total, 2092.488, 0.01);
});

test('开车通勤族：总量 ≈ 4435 kg（与答辩材料里的用例一致）', function () {
  const r = CF.compute(baseInput({
    transportMode: 'car', commuteKm: 100, otherKm: 40,
    monthlyKwh: 320, redMeat: 6, takeout: 5,
    dietType: 'meat', clothing: 6000, electronics: 5000
  }));
  near(r.total, 4435.4, 0.5, '总量');
});

test('总量 = 四个分项之和', function () {
  const r = CF.compute(baseInput({ transportMode: 'car', redMeat: 9, clothing: 12000 }));
  near(r.total, r.transport + r.elec + r.food + r.consume, 1e-9);
});

test('分项占比之和 = 100%', function () {
  const r = CF.compute(baseInput({ transportMode: 'car' }));
  const sum = r.items.reduce(function (s, it) { return s + it.share; }, 0);
  near(sum, 1, 1e-9);
});

test('家庭人口越多，人均用电越低', function () {
  const one = CF.compute(baseInput({ household: 1 })).elec;
  const four = CF.compute(baseInput({ household: 4 })).elec;
  ok(four < one, '4 人户的人均用电应低于 1 人户');
  near(one / four, 4, 1e-9, '倍数关系');
});

test('按人数估算模式：家庭总量 = 人均 × 人数', function () {
  const est = CF.estimateElec(3);
  near(est.total, est.perPerson * 3);
  const r = CF.compute(baseInput({ elecMode: 'estimate', household: 3 }));
  near(r.elecKwhYear, est.perPerson * 12, 1e-9);
});

test('步行通勤：出行分项为 0', function () {
  const r = CF.compute(baseInput({ transportMode: 'walk', commuteKm: 100, otherKm: 100 }));
  near(r.transport, 0);
});

/* =========================================================
   三、输入健壮性（脏数据不许算出 NaN）
   ========================================================= */
group('三、输入健壮性');

test('负数、NaN、空值都被夹到合法区间', function () {
  [
    { commuteKm: -50, monthlyKwh: -10, redMeat: -3, clothing: -1000 },
    { commuteKm: NaN, monthlyKwh: undefined, redMeat: 'abc', takeout: null },
    {},
    { household: 0 },
    { household: 99 }
  ].forEach(function (bad, i) {
    const r = CF.compute(baseInput(bad));
    ok(isFinite(r.total) && r.total >= 0, '第 ' + (i + 1) + ' 组脏数据算出了非法值：' + r.total);
    ok(r.input.household >= 1 && r.input.household <= 6, '家庭人口没被夹紧');
  });
});

test('超大输入不会爆表（周里程 9999 仍有限）', function () {
  const r = CF.compute(baseInput({ commuteKm: 9999, otherKm: 9999, monthlyKwh: 99999 }));
  ok(isFinite(r.total) && r.total > 0, '结果应为有限正数');
});

test('未知的通勤方式不会崩，回落到默认值', function () {
  const r = CF.compute(baseInput({ transportMode: 'ufo' }));
  ok(r.input.transportMode === 'metro', '未知方式应回落到 metro');
});

/* =========================================================
   四、等级划分边界
   ========================================================= */
group('四、等级边界');

test('恰好 2000 kg 仍是 A+，2000.1 掉到 A', function () {
  ok(CF.gradeOf(2000).grade === 'A+');
  ok(CF.gradeOf(2000.1).grade === 'A');
});

test('3500 / 5000 / 8000 三个边界都落在上一档', function () {
  ok(CF.gradeOf(3500).grade === 'A');
  ok(CF.gradeOf(5000).grade === 'B');
  ok(CF.gradeOf(8000).grade === 'C');
  ok(CF.gradeOf(8000.1).grade === 'D');
});

test('0 排放是 A+', function () {
  ok(CF.gradeOf(0).grade === 'A+');
});

/* =========================================================
   五、减排建议：数量、口径、不越界
   ========================================================= */
group('五、减排建议');

test('常规输入给满 5 条，且按减排量从大到小排', function () {
  const r = CF.compute(baseInput({
    transportMode: 'car', commuteKm: 100, otherKm: 40,
    monthlyKwh: 320, redMeat: 6, takeout: 5,
    dietType: 'meat', clothing: 6000, electronics: 5000
  }));
  const list = CF.suggestions(r);
  ok(list.length === 5, '应有 5 条建议，实际 ' + list.length);
  for (let i = 1; i < list.length; i++) {
    ok(list[i].kg <= list[i - 1].kg, '第 ' + i + ' 条没有按降序排列');
  }
});

test('每条建议的节省量都不超过它所属分项的排放', function () {
  const inputs = [
    baseInput({ transportMode: 'car', commuteKm: 100, redMeat: 6, takeout: 5, dietType: 'meat', clothing: 6000, electronics: 5000 }),
    baseInput({ transportMode: 'walk', commuteKm: 0, otherKm: 0, redMeat: 0, takeout: 0, dietType: 'plant', clothing: 0, electronics: 0 }),
    baseInput({ transportMode: 'bus', redMeat: 0, takeout: 0 }),
    baseInput({ transportMode: 'ev', monthlyKwh: 30, household: 6 })
  ];
  inputs.forEach(function (input, idx) {
    const r = CF.compute(input);
    const catTotal = { '出行': r.transport, '用电': r.elec, '饮食': r.food, '消费': r.consume };
    CF.suggestions(r).forEach(function (s) {
      ok(catTotal[s.cat] !== undefined, '建议的类别「' + s.cat + '」不存在');
      ok(s.kg <= catTotal[s.cat] + 0.001,
        '第 ' + (idx + 1) + ' 组：「' + s.title + '」要减 ' + s.kg.toFixed(1) +
        ' kg，但「' + s.cat + '」总共才 ' + catTotal[s.cat].toFixed(1) + ' kg');
    });
  });
});

test('所有建议加起来不超过总排放', function () {
  const r = CF.compute(baseInput({ transportMode: 'car', commuteKm: 100, redMeat: 6, takeout: 5, dietType: 'meat' }));
  const sum = CF.suggestions(r).reduce(function (s, it) { return s + it.kg; }, 0);
  ok(sum <= r.total + 0.001, '建议合计 ' + sum.toFixed(1) + ' 超过了总排放 ' + r.total.toFixed(1));
});

test('「重点」标记最多只有一个', function () {
  const r = CF.compute(baseInput({ transportMode: 'car', redMeat: 8, dietType: 'meat' }));
  const hot = CF.suggestions(r).filter(function (s) { return s.hot; });
  ok(hot.length <= 1, '出现了 ' + hot.length + ' 个重点标记');
});

test('零排放的极端输入不会崩，也不给"减负数"的建议', function () {
  const r = CF.compute({ transportMode: 'walk', commuteKm: 0, otherKm: 0, monthlyKwh: 0, household: 1, redMeat: 0, takeout: 0, dietType: 'plant', clothing: 0, electronics: 0 });
  const list = CF.suggestions(r);
  ok(Array.isArray(list), '应返回数组');
  list.forEach(function (s) { ok(s.kg > 0, '不该出现 0 或负数的减排量'); });
});

/* =========================================================
   六、模拟器不变量
   ========================================================= */
group('六、模拟器不变量');

test('把通勤系数降到地铁水平，总量必然下降', function () {
  const base = CF.compute(baseInput({ transportMode: 'car', commuteKm: 100 }));
  const sim = CF.compute(Object.assign({}, baseInput({ transportMode: 'car', commuteKm: 100 }), {
    commuteFactor: CF.FACTORS.transport.metro.factor
  }));
  ok(sim.total < base.total, '模拟后应低于原始值');
  // 只改通勤（100 km/周），其他出行（20 km/周）不受影响
  near(base.total - sim.total, 100 * 52 * (0.2 - 0.032), 0.01, '减排量');
});

/* =========================================================
   七、静态产物自查（部署前跑一遍）
   ========================================================= */

  root.CF_CASES = { groups: groups };
})(typeof window !== 'undefined' ? window : this);
