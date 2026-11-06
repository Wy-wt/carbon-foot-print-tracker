/* =========================================================
   engine.js · 计算引擎
   ---------------------------------------------------------
   输入 → 归一化 → 按排放系数换算 → 分项汇总 → 总量 + 等级
   所有口径都写在这里，页面只负责展示。
   ========================================================= */
window.CF = window.CF || {};

(function (CF) {
  'use strict';

  var WEEKS_PER_YEAR = 52;
  var MONTHS_PER_YEAR = 12;

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) n = min;
    return Math.min(max, Math.max(min, n));
  }

  /* 按人数估算家庭月用电量（返回家庭总量与人均值） */
  CF.estimateElec = function (people) {
    var p = clamp(Math.round(people || 1), 1, 6);
    var per = CF.ELEC_ESTIMATE[p] || 80;
    return { people: p, perPerson: per, total: per * p };
  };

  /* 输入归一化：任何脏数据都在这里被夹到合法区间 */
  CF.normalizeInput = function (raw) {
    raw = raw || {};
    var people = clamp(Math.round(raw.household || 1), 1, 6);
    var elecMode = raw.elecMode === 'estimate' ? 'estimate' : 'direct';
    var monthlyKwh = elecMode === 'estimate'
      ? CF.estimateElec(people).total
      : clamp(raw.monthlyKwh, 0, 2000);

    var modeKey = raw.transportMode;
    if (!CF.FACTORS.transport[modeKey]) modeKey = 'metro';

    var dietKey = raw.dietType;
    if (!CF.DIET.base[dietKey]) dietKey = 'balanced';

    return {
      transportMode: modeKey,
      commuteKm: clamp(raw.commuteKm, 0, 1000),
      otherKm: clamp(raw.otherKm, 0, 1000),
      commuteFactor: typeof raw.commuteFactor === 'number' ? clamp(raw.commuteFactor, 0, 1) : null,
      otherFactor: typeof raw.otherFactor === 'number' ? clamp(raw.otherFactor, 0, 1) : null,
      elecMode: elecMode,
      monthlyKwh: monthlyKwh,
      household: people,
      redMeat: clamp(Math.round(raw.redMeat), 0, 21),
      takeout: clamp(Math.round(raw.takeout), 0, 35),
      dietType: dietKey,
      clothing: clamp(raw.clothing, 0, 200000),
      electronics: clamp(raw.electronics, 0, 200000)
    };
  };

  /* 等级：按年度总量（kg）划线 */
  CF.gradeOf = function (totalKg) {
    for (var i = 0; i < CF.GRADES.length; i++) {
      if (totalKg <= CF.GRADES[i].max) return CF.GRADES[i];
    }
    return CF.GRADES[CF.GRADES.length - 1];
  };

  /* 主计算 */
  CF.compute = function (raw) {
    var input = CF.normalizeInput(raw);
    var mode = CF.FACTORS.transport[input.transportMode];
    var factor = input.commuteFactor === null ? mode.factor : input.commuteFactor;
    var otherFactor = input.otherFactor === null ? mode.factor : input.otherFactor;

    /* --- 出行 --- */
    var commuteKmYear = input.commuteKm * WEEKS_PER_YEAR;
    var otherKmYear = input.otherKm * WEEKS_PER_YEAR;
    var commute = commuteKmYear * factor;
    var other = otherKmYear * otherFactor;

    /* --- 用电（家庭总量按人数平摊）--- */
    var elecKwhYear = input.monthlyKwh * MONTHS_PER_YEAR / input.household;
    var elec = elecKwhYear * CF.ELEC_FACTOR;

    /* --- 饮食 --- */
    var foodBase = CF.DIET.base[input.dietType];
    var redMeatKg = input.redMeat * WEEKS_PER_YEAR * CF.DIET.redMeatPerServing;
    var takeoutKg = input.takeout * WEEKS_PER_YEAR * CF.DIET.takeoutPerMeal;

    /* --- 消费 --- */
    var clothingKg = input.clothing * CF.CONSUME.clothing;
    var electronicsKg = input.electronics * CF.CONSUME.electronics;

    var transport = commute + other;
    var food = foodBase + redMeatKg + takeoutKg;
    var consume = clothingKg + electronicsKg;
    var total = transport + elec + food + consume;

    var items = [
      { key: 'transport', label: '出行', icon: '🚇', color: '#0ea5e9', kg: transport },
      { key: 'elec',      label: '用电', icon: '💡', color: '#f59e0b', kg: elec },
      { key: 'food',      label: '饮食', icon: '🍚', color: '#16a34a', kg: food },
      { key: 'consume',   label: '消费', icon: '🛍️', color: '#a855f7', kg: consume }
    ];

    items.forEach(function (it) {
      it.share = total > 0 ? it.kg / total : 0;
    });

    var rows = [
      { label: '通勤（' + mode.label + '）', amount: CF.fmt(commuteKmYear) + ' km/年', kg: commute, color: '#0ea5e9' },
      { label: '其他出行', amount: CF.fmt(otherKmYear) + ' km/年', kg: other, color: '#38bdf8' },
      { label: '家庭用电（人均）', amount: CF.fmt(elecKwhYear) + ' kWh/年', kg: elec, color: '#f59e0b' },
      { label: '红肉', amount: CF.fmt(input.redMeat * WEEKS_PER_YEAR) + ' 次/年', kg: redMeatKg, color: '#16a34a' },
      { label: '日常饮食（' + CF.DIET.baseLabel[input.dietType] + '）', amount: '按饮食结构估算', kg: foodBase, color: '#4ade80' },
      { label: '外卖', amount: CF.fmt(input.takeout * WEEKS_PER_YEAR) + ' 次/年', kg: takeoutKg, color: '#a3e635' },
      { label: '衣物', amount: CF.fmt(input.clothing) + ' 元/年', kg: clothingKg, color: '#a855f7' },
      { label: '电子产品', amount: CF.fmt(input.electronics) + ' 元/年', kg: electronicsKg, color: '#c084fc' }
    ].filter(function (r) { return r.kg > 0.5; });

    var grade = CF.gradeOf(total);

    return {
      input: input,
      factor: factor,
      mode: mode,
      transport: transport,
      commute: commute,
      other: other,
      elec: elec,
      elecKwhYear: elecKwhYear,
      food: food,
      foodBase: foodBase,
      redMeatKg: redMeatKg,
      takeoutKg: takeoutKg,
      consume: consume,
      clothingKg: clothingKg,
      electronicsKg: electronicsKg,
      total: total,
      items: items,
      rows: rows,
      grade: grade
    };
  };

  /* 把结果压成可存进 localStorage 的轻量结构 */
  CF.snapshot = function (result) {
    var b = {};
    result.items.forEach(function (it) { b[it.key] = Math.round(it.kg); });
    return {
      ts: Date.now(),
      total: Math.round(result.total),
      grade: result.grade.grade,
      breakdown: b,
      input: result.input
    };
  };


  CF.suggestions = function (r) {
    /* 减排建议：纯函数，只依赖计算结果，方便单元测试 */
  var inp = r.input;
    var list = [];
    var commuteKmYear = inp.commuteKm * WEEKS_PER_YEAR;
    var modeFactor = r.factor;

    /* 1. 通勤方式 */
    if (commuteKmYear > 0 && modeFactor > 0.05) {
      var target = Math.min(modeFactor, CF.FACTORS.transport.metro.factor);
      var save = commuteKmYear * 0.4 * (modeFactor - target);
      if (save > 5) {
        list.push({
          cat: '出行',
          title: '每周挑 2 天改乘地铁 / 公交通勤',
          desc: '你现在主要靠' + r.mode.label + '，每周通勤 ' + CF.fmt(inp.commuteKm) + ' km；把其中 2/5 换成公共交通，顺便避开通勤高峰。',
          kg: save
        });
      }
    }

    /* 2. 红肉 */
    if (inp.redMeat >= 3) {
      var cutMeat = Math.min(2, inp.redMeat);
      list.push({
        cat: '饮食',
        title: '每周少吃 ' + cutMeat + ' 次红肉',
        desc: '一年 ' + CF.fmt(inp.redMeat * WEEKS_PER_YEAR) + ' 次红肉，减到 ' + CF.fmt((inp.redMeat - cutMeat) * WEEKS_PER_YEAR) +
          ' 次；用鸡胸、鱼、豆制品替代，蛋白质并不会少。',
        kg: cutMeat * WEEKS_PER_YEAR * CF.DIET.redMeatPerServing
      });
    }

    /* 3. 外卖 */
    if (inp.takeout >= 4) {
      var cutTakeout = Math.max(1, Math.round(inp.takeout / 2));
      list.push({
        cat: '饮食',
        title: '每周少点 ' + cutTakeout + ' 次外卖',
        desc: '自带饭盒或去食堂，省下的不只是钱，还有一次性餐盒和配送里程。',
        kg: cutTakeout * WEEKS_PER_YEAR * CF.DIET.takeoutPerMeal
      });
    }

    /* 4. 用电 */
    if (r.elec > 120) {
      list.push({
        cat: '用电',
        title: '把家庭月用电降一成',
        desc: '空调调高 1℃、换 LED 灯、拔掉待机插头。按每月 ' + CF.fmt(inp.monthlyKwh) +
          ' 度算，省下约 ' + CF.fmt(inp.monthlyKwh * 0.1) + ' 度。',
        kg: r.elec * 0.1
      });
    }

    /* 5. 饮食结构 */
    if (inp.dietType !== 'plant') {
      var gap = r.foodBase - CF.DIET.base.plant;
      if (gap > 0) {
        list.push({
          cat: '饮食',
          title: '把饮食结构往植物性倾斜',
          desc: '你目前是「' + CF.DIET.baseLabel[inp.dietType] + '」。每周用 2~3 餐豆制品、全谷物替代肉类，就是最省钱的一档减排。',
          kg: gap * 0.6
        });
      }
    }

    /* 6. 衣物 */
    if (inp.clothing >= 3000) {
      list.push({
        cat: '消费',
        title: '衣物少买三成',
        desc: '先穿现有的，二手循环也算；一件耐穿的基础款胜过三件快时尚。',
        kg: r.clothingKg * 0.3
      });
    }

    /* 7. 电子产品 */
    if (inp.electronics >= 4000) {
      list.push({
        cat: '消费',
        title: '手机 / 电脑多用一年',
        desc: '把换机周期从 2 年拉到 3 年，制造环节的排放直接被摊薄三分之一。',
        kg: r.electronicsKg * 0.33
      });
    }

    /* 8. 兜底：数据都很低时也给几条 */
    var fallback = [
      { cat: '出行', title: '3 公里内步行或骑车', desc: '每周 3 次短途不坐车，一年就是 150 多公里。', kg: 3 * 3 * WEEKS_PER_YEAR * CF.FACTORS.transport.car.factor },
      { cat: '用电', title: '随手关灯、拔掉待机插头', desc: '待机功耗通常占家庭用电的 5%~10%。', kg: 60 },
      { cat: '饮食', title: '按需点餐、剩菜打包', desc: '食物浪费的排放常常被忽略。', kg: 40 }
    ];
    // 兜底建议也要守规矩：分项本身的排放都不够减，就不该给出这条
    var catTotal = { '出行': r.transport, '用电': r.elec, '饮食': r.food, '消费': r.consume };
    fallback.forEach(function (f) {
      if (list.length >= 3) return;
      if ((catTotal[f.cat] || 0) <= f.kg) return;
      list.push(f);
    });

    list.sort(function (a, b) { return b.kg - a.kg; });
    var picked = list.slice(0, 5);

    // 只给「排放占比最大的那一类」打一个「重点」标记，避免满屏都是重点
    picked.forEach(function (it) { it.hot = false; });
    var dominant = r.items.slice().sort(function (a, b) { return b.kg - a.kg; })[0];
    if (dominant) {
      for (var i = 0; i < picked.length; i++) {
        if (picked[i].cat === dominant.label) { picked[i].hot = true; break; }
      }
    }

    return picked;
  };

})(window.CF);
