/* =========================================================
   factors.js · 排放系数与基准数据
   ---------------------------------------------------------
   全部采用「排放因子法」：总排放 = Σ(活动量 × 排放系数)
   数据来源为公开研究/官方统计的常用取值，课堂上按"示意系数"使用。
   修改这里的数字即可调整整个模型，计算逻辑不用动。
   ========================================================= */
window.CF = window.CF || {};

(function (CF) {
  'use strict';

  /* ---------------- 出行：kg CO₂e / km ---------------- */
  CF.FACTORS = {
    transport: {
      walk:  { key: 'walk',  label: '步行 / 骑行', icon: '🚶', factor: 0.000, note: '不计入直接排放' },
      ebike: { key: 'ebike', label: '电动自行车',  icon: '🛵', factor: 0.007, note: '百公里电耗约 1.2 kWh' },
      metro: { key: 'metro', label: '地铁',        icon: '🚇', factor: 0.032, note: '城市轨道客运平均' },
      bus:   { key: 'bus',   label: '公交',        icon: '🚌', factor: 0.045, note: '城市公交客运平均' },
      taxi:  { key: 'taxi',  label: '打车 / 网约车', icon: '🚕', factor: 0.160, note: '含空驶与调度' },
      car:   { key: 'car',   label: '燃油私家车',  icon: '🚗', factor: 0.200, note: '百公里油耗约 7 L' },
      ev:    { key: 'ev',    label: '新能源私家车', icon: '🔌', factor: 0.100, note: '百公里电耗 17 kWh' }
    }
  };

  /* ---------------- 用电 ---------------- */
  // 全国电网平均 CO₂ 排放因子（kg CO₂e / kWh）
  CF.ELEC_FACTOR = 0.5703;

  // 按人数估算：人均每月用电量（度），人越多，人均公共用电越省
  CF.ELEC_ESTIMATE = { 1: 120, 2: 100, 3: 92, 4: 82, 5: 74, 6: 68 };

  /* ---------------- 饮食 ---------------- */
  CF.DIET = {
    // 一次红肉按 150 g 计；混合红肉系数 13.3 kg CO₂e/kg
    // （牛肉 27、猪肉 6、羊肉 20，按国人消费结构加权）
    perMealKg: 0.15,
    redMeatFactor: 13.3,
    // 每次外卖：餐盒 + 包装 + 配送 + 额外食物浪费
    takeoutPerMeal: 0.45,
    // 基础饮食（主食、蔬菜、蛋奶等）年排放，kg
    base: { plant: 560, balanced: 700, meat: 950 },
    baseLabel: {
      plant: '以植物为主',
      balanced: '荤素均衡',
      meat: '以肉为主'
    }
  };

  // 一次红肉的排放 = 150 g × 13.3 = 2.0 kg（四舍五入后写入系数表）
  CF.DIET.redMeatPerServing = CF.DIET.perMealKg * CF.DIET.redMeatFactor; // ≈ 1.995

  /* ---------------- 消费：kg CO₂e / 元 ---------------- */
  CF.CONSUME = {
    clothing: 0.06,      // 衣物（纺织服装，含生产与运输）
    electronics: 0.04    // 电子产品（含生产制造）
  };

  /* ---------------- 三条基准线：kg CO₂e / 人 / 年 ---------------- */
  CF.BENCHMARKS = [
    {
      key: 'national',
      label: '全国人均',
      value: 8000,
      color: '#f59e0b',
      desc: '中国能源相关 CO₂ 人均排放约 8 吨 / 年'
    },
    {
      key: 'global',
      label: '全球人均',
      value: 4700,
      color: '#0ea5e9',
      desc: '全球平均约 4.7 吨 / 年'
    },
    {
      key: 'paris',
      label: '巴黎协定目标',
      value: 2000,
      color: '#16a34a',
      desc: '1.5℃ 情景下 2050 年人均需 ≤ 2 吨'
    }
  ];

  /* ---------------- 等级勋章 ---------------- */
  CF.GRADES = [
    { grade: 'A+', max: 2000,  title: '气候先锋',   color: '#059669', desc: '已经达到巴黎协定的人均目标线' },
    { grade: 'A',  max: 3500,  title: '低碳生活家', color: '#10b981', desc: '明显低于全球人均水平' },
    { grade: 'B',  max: 5000,  title: '中等排放',   color: '#3b82f6', desc: '接近全球人均，还有下降空间' },
    { grade: 'C',  max: 8000,  title: '偏高排放',   color: '#f59e0b', desc: '高于全球人均，接近国内人均' },
    { grade: 'D',  max: Infinity, title: '高排放',  color: '#dc2626', desc: '已超过全国人均水平' }
  ];

  /* ---------------- 四大类别的颜色 ---------------- */
  CF.CATEGORY = [
    { key: 'transport', label: '出行',   icon: '🚇', color: '#0ea5e9' },
    { key: 'elec',      label: '用电',   icon: '💡', color: '#f59e0b' },
    { key: 'food',      label: '饮食',   icon: '🍚', color: '#16a34a' },
    { key: 'consume',   label: '消费',   icon: '🛍️', color: '#a855f7' }
  ];

  /* ---------------- 小工具 ---------------- */
  // 一棵成年树一年大约吸收 20 kg CO₂
  CF.TREE_KG_PER_YEAR = 20;

  CF.fmt = function (n, digits) {
    var d = typeof digits === 'number' ? digits : 0;
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    var s = v.toFixed(d);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };

  // kg → 吨，保留两位
  CF.toTons = function (kg) {
    return (Number(kg) || 0) / 1000;
  };

  CF.tonsText = function (kg, digits) {
    return CF.toTons(kg).toFixed(typeof digits === 'number' ? digits : 2);
  };

})(window.CF);
