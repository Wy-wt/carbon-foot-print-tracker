/* =========================================================
   app.js · 界面与交互
   ---------------------------------------------------------
   1. 视图切换（首页 / 输入 / 结果）
   2. 表单读取与校验
   3. 结果渲染：大数字、等级、基准对比、图表、明细
   4. 动态减排建议
   5. 减排模拟器（实时重算）
   6. 历史记录（localStorage）+ 趋势
   7. 分享卡片（Canvas 导出 PNG）
   ========================================================= */
(function () {
  'use strict';

  var CF = window.CF;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  var WEEKS = 52;
  var STORE_KEY = 'cf-history-v1';

  var state = {
    view: 'home',
    elecMode: 'direct',
    input: null,
    result: null,
    sim: null,
    history: [],
    storeOk: true
  };

  /* =======================================================
     小工具
     ======================================================= */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-open'); }, 2400);
  }

  /*------表单状态条------*/
  var statusTimer = null;

  function showStatus(type, text, target){
    var el = $('#formStatus');
    if(!el) return;

    clearTimeout(statusTimer);                //连续触发时，先清掉上一次的计时器
    el.className = 'form-status is-' + type;  //is-error / is-warn / is-ok
    el.querySelector('.fs-icon').textContent = (type === 'ok') ? '✓' : '!';
    el.querySelector('.fs-text').textContent = text;

    //只有“真的错了”才给输入框标红；被自动修正的不算错
    if (target && type === 'error') {
      target.classList.add('is-invalid');
      target.setAttribute('aria-invalid', 'true');
    }

    if (type !== 'error') {
      statusTimer = setTimeout(hideStatus, 6000);   //提示类6秒自动消失，错误类留着等用户改
    }
  }

  function hideStatus() {
    var el = $('#formStatus');
    if (el) el.className = 'form-status is-hidden';
    $$('.is-invalid').forEach(function (input) {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    });
  }

  function pct(a, b) {
    if (!b) return 0;
    return (a / b) * 100;
  }

  function fieldOf(key) {
    return document.querySelector('.slider-field[data-key="' + key + '"]');
  }

  function syncField(field) {
    if (!field) return 0;
    var range = field.querySelector('.js-range');
    var num = field.querySelector('.js-num');
    var min = Number(range.min);
    var max = Number(range.max);
    var v = Number(num.value);
    if (!isFinite(v) || num.value === '') v = min;

    var fixed = Math.min(max, Math.max(min, v));
    if (num.value !== '' && isFinite(v) && fixed !== v) {
      showStatus('warn', '「' + fieldLabel(field) + '」范围是 ' + min + '~' + max + '，已按 ' + fixed + ' 计算', num);
    }

    num.value = fixed;
    range.value = fixed;
    return fixed;
  }

  /* 取这一格的标题文字，用于提示语 */
    function fieldLabel(field) {
      var q = field.closest('.q');
      var label = q ? q.querySelector('.q-label') : null;
      return label ? label.textContent.replace(/（.*?）/g, '').trim() : '这一项';
    }

  function fieldValue(key) {
    return syncField(fieldOf(key));
  }

  /* =======================================================
     视图切换
     ======================================================= */
  function show(view) {
    if (view === 'result' && !state.result) {
      toast('先填一下数据，算完才有结果～');
      view = 'form';
    }

    var target = document.getElementById('view-' + view);
    if (!target) return;

    $$('.view').forEach(function (el) {
      el.classList.toggle('is-active', el === target);
    });

    $$('.nav-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-nav') === view);
    });

    state.view = view;

    if (view === 'result') {
      renderResult();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =======================================================
     表单
     ======================================================= */
  function setElecMode(mode) {
    state.elecMode = mode;
    $$('.seg').forEach(function (btn) {
      var on = btn.getAttribute('data-elecmode') === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var direct = $('#kwhDirectWrap');
    var estimate = $('#kwhEstimateWrap');
    if (direct) direct.classList.toggle('is-hidden', mode !== 'direct');
    if (estimate) estimate.classList.toggle('is-hidden', mode !== 'estimate');
    updateEstimateHint();
  }

  function updateEstimateHint() {
    var box = $('#estBox');
    if (!box) return;
    // 这里只读不写回，避免用户输入「30」时被立刻改成「6」
    var field = fieldOf('household');
    var people = 3;
    if (field) {
      var v = Number(field.querySelector('.js-num').value);
      people = isFinite(v) ? Math.min(6, Math.max(1, Math.round(v))) : 3;
    }
    var est = CF.estimateElec(people);
    box.innerHTML = '按 ' + est.people + ' 人家庭估算：约 <b>' + est.total +
      '</b> 度 / 月（人均 ' + est.perPerson + ' 度 / 月）';
  }

  function readInput() {
    var modeEl = document.querySelector('input[name="mode"]:checked');
    var dietEl = document.querySelector('input[name="diet"]:checked');

    return {
      transportMode: modeEl ? modeEl.value : 'metro',
      commuteKm: fieldValue('commuteKm'),
      otherKm: fieldValue('otherKm'),
      elecMode: state.elecMode,
      monthlyKwh: fieldValue('monthlyKwh'),
      household: fieldValue('household'),
      redMeat: fieldValue('redMeat'),
      takeout: fieldValue('takeout'),
      dietType: dietEl ? dietEl.value : 'balanced',
      clothing: fieldValue('clothing'),
      electronics: fieldValue('electronics')
    };
  }

  function bindForm() {
    $$('.slider-field').forEach(function (field) {
      var range = field.querySelector('.js-range');
      var num = field.querySelector('.js-num');
      var key = field.getAttribute('data-key');

      range.addEventListener('input', function () {
        num.value = range.value;
        if (key === 'household') updateEstimateHint();

      });

      num.addEventListener('input', function () {
        var v = Number(num.value);
        if (!isFinite(v)) return;
        var min = Number(range.min);
        var max = Number(range.max);
        range.value = Math.min(max, Math.max(min, v));
        if (key === 'household') updateEstimateHint();
                if (num.classList.contains('is-invalid') && num.value !== '') hideStatus();
      });

      num.addEventListener('blur', function () {
        syncField(field);
        if (key === 'household') updateEstimateHint();
      });
    });

    $$('.seg').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setElecMode(btn.getAttribute('data-elecmode'));
      });
    });

    var form = $('#cfForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        onSubmit();
      });
      form.addEventListener('reset', function () {
        setTimeout(function () {
          state.elecMode = 'direct';
          setElecMode('direct');
          $$('.slider-field').forEach(syncField);
          updateEstimateHint();
          toast('已恢复默认值');
        }, 0);
      });
    }
  }

  function onSubmit() {

    /* 先校验：有任何一项不能用，就挡住提交 */
      var bad = validateForm();
      if (bad) {
        showStatus('error', bad.msg, bad.el);
        bad.el.focus();          // 把光标放回出错那一格（键盘用户也能立刻改）
        bad.el.select();
        return;
      }
      hideStatus();

    var input = readInput();
    state.input = input;
    state.result = CF.compute(input);

    var note = $('#formNote');
    if (note) note.textContent = '已按你的数据算好';

    show('result');
    toast('算好啦：一年约 ' + CF.tonsText(state.result.total, 2) + ' 吨 CO₂e');
  }

  /* 校验：返回第一个出问题的字段，全对返回 null */
    function validateForm() {
      var first = null;
      $$('#cfForm .slider-field').forEach(function (field) {
        var num = field.querySelector('.js-num');
        var min = Number(field.querySelector('.js-range').min);
        var max = Number(field.querySelector('.js-range').max);
        var raw = num.value;
        var v = Number(raw);
        var name = fieldLabel(field);

        if (first) return;                                  // 只报第一个，别一次甩十条
        if (raw === '' || !isFinite(v)) {
          first = { el: num, msg: '「' + name + '」还没填，请填一个 ' + min + '~' + max + ' 之间的数字' };
        } else if (v < min || v > max) {
          first = { el: num, msg: '「' + name + '」必须在 ' + min + '~' + max + ' 之间，现在是 ' + v };
        }
      });
      return first;
    }

  /* =======================================================
     结果：文案
     ======================================================= */
  function compareText(total, base, baseLabel) {
    if (base <= 0) return '';
    if (total <= 0) return '比' + baseLabel + '低 100%';
    var diff = (1 - total / base) * 100;
    if (Math.abs(diff) < 1) return '和' + baseLabel + '基本持平';
    return diff > 0
      ? '比' + baseLabel + '低 ' + diff.toFixed(0) + '%'
      : '比' + baseLabel + '高 ' + Math.abs(diff).toFixed(0) + '%';
  }

  function buildVerdict(r) {
    var total = r.total;
    var nat = 8000, glob = 4700, paris = 2000;
    var parts = [];

    parts.push('你一年排放 <b>' + CF.tonsText(total, 2) + ' 吨</b>，' + compareText(total, nat, '全国人均（8.0 吨）'));
    parts.push(compareText(total, glob, '全球人均（4.7 吨）'));

    if (total <= paris) {
      parts.push('已经低于巴黎协定人均目标线（2.0 吨），属于真正意义上的低碳生活 🎉');
    } else {
      parts.push('仍是巴黎协定目标（2.0 吨）的 <b>' + (total / paris).toFixed(2) + ' 倍</b>');
    }

    return parts.join('，') + '。';
  }

  function buildEquiv(r) {
    var total = r.total;
    var trees = Math.round(total / CF.TREE_KG_PER_YEAR);
    var carKm = Math.round(total / CF.FACTORS.transport.car.factor);
    var kwh = Math.round(total / CF.ELEC_FACTOR);
    return [
      '🌳 约等于 ' + CF.fmt(trees) + ' 棵树一年的吸收量',
      '🚗 约等于开车 ' + CF.fmt(carKm) + ' 公里',
      '⚡ 约等于 ' + CF.fmt(kwh) + ' 度电的排放'
    ].map(function (t) { return '<span>' + t + '</span>'; }).join('');
  }

  function renderBench(r) {
    var box = $('#benchGrid');
    if (!box) return;
    var html = CF.BENCHMARKS.map(function (b) {
      var diff = (1 - r.total / b.value) * 100;
      var cls = Math.abs(diff) < 1 ? 'even' : (diff > 0 ? 'good' : 'bad');
      var text = Math.abs(diff) < 1 ? '基本持平'
        : (diff > 0 ? '低 ' + diff.toFixed(0) + '%' : '高 ' + Math.abs(diff).toFixed(0) + '%');
      return '<div class="bench-card">' +
        '<p class="bench-label"><span class="cat-dot" style="background:' + b.color + '"></span>' + b.label + '</p>' +
        '<span class="bench-value">' + (b.value / 1000).toFixed(2) + '<small>t</small></span>' +
        '<p class="bench-diff ' + cls + '">你 ' + text + '</p>' +
        '</div>';
    }).join('');
    box.innerHTML = html;
  }

  function buildBarRows(r) {
    return [
      { label: '巴黎目标', kg: 2000, color: '#16a34a', note: '1.5℃ 情景 · 2050' },
      { label: '全球人均', kg: 4700, color: '#0ea5e9', note: '全球平均' },
      { label: '全国人均', kg: 8000, color: '#f59e0b', note: '中国能源相关 CO₂' },
      { label: '你', kg: r.total, color: '#059669', you: true, note: '本次计算结果' }
    ];
  }

  function renderDetail(r) {
    var body = $('#detailBody');
    if (!body) return;
    var total = r.total;

    var html = r.rows.map(function (row) {
      var share = total > 0 ? (row.kg / total) * 100 : 0;
      return '<tr>' +
        '<td><span class="cat-dot" style="background:' + row.color + '"></span>' + row.label + '</td>' +
        '<td class="amount">' + row.amount + '</td>' +
        '<td class="num">' + CF.fmt(row.kg) + '</td>' +
        '<td>' + shareCell(share, row.color) + '</td>' +
        '</tr>';
    }).join('');

    html += '<tr style="background:#f8fafc;font-weight:800">' +
      '<td>合计</td><td class="amount">—</td>' +
      '<td class="num">' + CF.fmt(total) + '</td>' +
      '<td>' + shareCell(100, '#0f172a') + '</td>' +
      '</tr>';

    body.innerHTML = html;
  }

  function shareCell(share, color) {
    var w = Math.max(0, Math.min(100, share));
    return '<div class="share-cell">' +
      '<span class="share-track"><span class="share-fill" style="width:' + w.toFixed(1) + '%;background:' + color + '"></span></span>' +
      '<span class="share-pct">' + share.toFixed(1) + '%</span>' +
      '</div>';
  }

  function renderLegend(r) {
    var box = $('#donutLegend');
    if (!box) return;
    box.innerHTML = r.items.map(function (it) {
      return '<li><span class="dot" style="background:' + it.color + '"></span>' +
        it.label + ' <span class="val">' + CF.tonsText(it.kg, 2) + ' t · ' +
        (it.share * 100).toFixed(0) + '%</span></li>';
    }).join('');
  }

  /* =======================================================
     结果：减排建议
     ======================================================= */

  function renderSuggestions(r) {
    var box = $('#sugList');
    var summary = $('#sugSummary');
    if (!box) return;

    var list = CF.suggestions(r);
    var potential = list.reduce(function (s, it) { return s + it.kg; }, 0);
    var after = Math.max(0, r.total - potential);

    if (summary) {
      summary.innerHTML = '按你目前的排放结构（出行 ' + CF.tonsText(r.transport, 2) +
        ' t、用电 ' + CF.tonsText(r.elec, 2) + ' t、饮食 ' + CF.tonsText(r.food, 2) +
        ' t、消费 ' + CF.tonsText(r.consume, 2) + ' t），下面 ' + list.length +
        ' 条全部做到，一年可减 <b>' + CF.fmt(potential) + ' kg</b>，降到 <b>' +
        CF.tonsText(after, 2) + ' 吨</b>。';
    }

    box.innerHTML = list.map(function (it) {
      return '<li class="sug-item">' +
        '<div class="sug-main">' +
        '<p class="sug-title">' + it.title +
        '<span class="sug-tag">' + it.cat + '</span>' +
        (it.hot ? '<span class="sug-tag hot">重点</span>' : '') +
        '</p>' +
        '<p class="sug-desc">' + it.desc + '</p>' +
        '</div>' +
        '<div class="sug-save"><b>- ' + CF.fmt(it.kg) + '</b>kg / 年</div>' +
        '</li>';
    }).join('');
  }

  /* =======================================================
     减排模拟器
     ======================================================= */
  var SIM_DEFS = [
    { key: 'transit', title: '通勤改为公共交通的比例', min: 0, max: 100, step: 5, suffix: '%' },
    { key: 'redMeat', title: '每周红肉次数', min: 0, max: 14, step: 1, suffix: ' 次/周' },
    { key: 'takeout', title: '每周外卖次数', min: 0, max: 21, step: 1, suffix: ' 次/周' },
    { key: 'kwh', title: '家庭月用电量', min: 30, max: 800, step: 10, suffix: ' 度/月' },
    { key: 'clothing', title: '衣物支出', min: 0, max: 100, step: 5, suffix: '%' }
  ];

  function defaultSim(r) {
    return {
      transit: 0,
      redMeat: r.input.redMeat,
      takeout: r.input.takeout,
      kwh: Math.round(r.input.monthlyKwh),
      clothing: 100
    };
  }

  function simText(def, value) {
    if (def.key === 'clothing') return '原来的 ' + value + '%';
    return value + def.suffix;
  }

  function initSimulator(r) {
    state.sim = defaultSim(r);
    renderSimulator(r);
  }

  function walkSim() {
    var r = state.result;
    if (!r) return null;
    var s = state.sim;
    var inp = r.input;

    var startFactor = r.factor;
    var blended = startFactor * (1 - s.transit / 100) +
      CF.FACTORS.transport.metro.factor * (s.transit / 100);
    // 只允许往下降，不允许因为滑动反而变高
    blended = Math.min(startFactor, blended);

    var mod = {
      transportMode: inp.transportMode,
      commuteKm: inp.commuteKm,
      otherKm: inp.otherKm,
      commuteFactor: blended,
      elecMode: 'direct',
      monthlyKwh: s.kwh,
      household: inp.household,
      redMeat: s.redMeat,
      takeout: s.takeout,
      dietType: inp.dietType,
      clothing: inp.clothing * (s.clothing / 100),
      electronics: inp.electronics
    };

    return CF.compute(mod);
  }

  function renderSimulator(r) {
    var controls = $('#simControls');
    if (!controls) return;

    var canTransit = r.factor > 0.032;

    controls.innerHTML = SIM_DEFS.map(function (def) {
      var disabled = def.key === 'transit' && !canTransit;
      var max = def.max;
      var value = state.sim[def.key];

      if (def.key === 'kwh') {
        max = Math.max(800, Math.ceil(r.input.monthlyKwh / 10) * 10);
        max = Math.min(1500, max);
      }
      if (def.key === 'redMeat') max = Math.max(14, r.input.redMeat);
      if (def.key === 'takeout') max = Math.max(21, r.input.takeout);

      return '<div class="sim-row" data-sim="' + def.key + '">' +
        '<div class="sim-row-head">' +
        '<span class="sim-row-title">' + def.title + '</span>' +
        '<span class="sim-value" data-sim-value="' + def.key + '">' +
        (disabled ? '已是公共交通' : simText(def, value)) + '</span>' +
        '</div>' +
        '<input type="range" min="' + def.min + '" max="' + max + '" step="' + def.step + '" ' +
        'value="' + value + '" ' + (disabled ? 'disabled' : '') +
        ' aria-label="' + def.title + '" data-sim-input="' + def.key + '">' +
        '</div>';
    }).join('');

    $$('[data-sim-input]').forEach(function (input) {
      input.addEventListener('input', function () {
        var key = input.getAttribute('data-sim-input');
        state.sim[key] = Number(input.value);
        var def = null;
        SIM_DEFS.forEach(function (d) { if (d.key === key) def = d; });
        var label = document.querySelector('[data-sim-value="' + key + '"]');
        if (label && def) label.textContent = simText(def, state.sim[key]);
        updateSimulator();
      });
    });

    var resetBtn = $('#btnSimReset');
    if (resetBtn && !resetBtn.__bound) {
      resetBtn.__bound = true;
      resetBtn.addEventListener('click', function () {
        if (!state.result) return;
        state.sim = defaultSim(state.result);
        renderSimulator(state.result);
        updateSimulator();
      });
    }

    updateSimulator();
  }

  function updateSimulator() {
    var base = state.result;
    if (!base) return;
    var sim = walkSim();
    if (!sim) return;

    var total = sim.total;
    var delta = base.total - total;
    var totalEl = $('#simTotal');
    var deltaEl = $('#simDelta');
    var gradeEl = $('#simGrade');
    var barEl = $('#simBarFill');
    var targetEl = $('#simTarget');

    if (totalEl) totalEl.textContent = CF.tonsText(total, 2);

    if (deltaEl) {
      if (delta > 2) {
        deltaEl.className = 'sim-delta down';
        deltaEl.innerHTML = '比现在少 <b>' + CF.fmt(delta) + ' kg/年</b>（-' + pct(delta, base.total).toFixed(0) + '%）';
      } else if (delta < -2) {
        deltaEl.className = 'sim-delta up';
        deltaEl.innerHTML = '比现在多 <b>' + CF.fmt(Math.abs(delta)) + ' kg/年</b>';
      } else {
        deltaEl.className = 'sim-delta flat';
        deltaEl.textContent = '拖动左边滑块试试';
      }
    }

    if (gradeEl) {
      var g = sim.grade;
      gradeEl.textContent = '等级 ' + g.grade + ' · ' + g.title;
    }

    if (barEl) {
      var reduction = base.total > 0 ? Math.max(0, Math.min(100, (delta / base.total) * 100)) : 0;
      barEl.style.width = reduction.toFixed(1) + '%';
    }

    if (targetEl) {
      var gap = total - 2000;
      targetEl.textContent = gap <= 0
        ? '已经低于巴黎协定目标线（2.0 t）🎉'
        : '距离巴黎协定目标线（2.0 t）还差 ' + CF.fmt(gap) + ' kg';
    }
  }

  /* =======================================================
     结果渲染总入口
     ======================================================= */
  function renderResult() {
    var r = state.result;
    if (!r) return;

    var total = r.total;

    var totalEl = $('#resTotal');
    if (totalEl) totalEl.textContent = CF.tonsText(total, 2);
    var kgEl = $('#resKg');
    if (kgEl) kgEl.textContent = CF.fmt(total);
    var dayEl = $('#resDay');
    if (dayEl) dayEl.textContent = (total / 365).toFixed(1);

    var badge = $('#resGrade');
    if (badge) {
      badge.textContent = r.grade.grade;
      badge.style.setProperty('--g', r.grade.color);
    }
    var gradeTitle = $('#resGradeTitle');
    if (gradeTitle) gradeTitle.textContent = r.grade.title;

    var verdict = $('#resVerdict');
    if (verdict) verdict.innerHTML = buildVerdict(r);

    var equiv = $('#resEquiv');
    if (equiv) equiv.innerHTML = buildEquiv(r);

    renderBench(r);

    var center = $('#donutCenter');
    if (center) center.textContent = CF.tonsText(total, 2);
    renderLegend(r);

    if (CF.charts) {
      CF.charts.donut($('#donutChart'), r.items, total);
      CF.charts.bars($('#barChart'), buildBarRows(r));
    }

    var barNote = $('#barNote');
    if (barNote) {
      if (total <= 2000) {
        barNote.textContent = '你已低于巴黎协定目标线，领先 ' + CF.fmt(2000 - total) + ' kg。';
      } else {
        barNote.textContent = '你的排放是巴黎目标的 ' + (total / 2000).toFixed(2) + ' 倍，每年还需再减 ' +
          CF.fmt(total - 2000) + ' kg 才能达标。';
      }
    }

    renderDetail(r);
    renderSuggestions(r);
    initSimulator(r);
  }

  /* 图表库晚到时就重绘一次（保证用的是 ECharts 而不是兜底图形） */
  function refreshCharts() {
    if (state.view !== 'result' || !state.result) return;
    if (!CF.charts) return;
    CF.charts.donut($('#donutChart'), state.result.items, state.result.total);
    CF.charts.bars($('#barChart'), buildBarRows(state.result));
    if (state.history.length) renderTrend();
  }

  /* =======================================================
     历史记录
     ======================================================= */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      state.history = Array.isArray(arr) ? arr : [];
    } catch (e) {
      state.history = [];
      state.storeOk = false;
    }
  }

  function persistHistory() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.history));
      state.storeOk = true;
    } catch (e) {
      state.storeOk = false;
    }
  }

  function dateText(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    var hh = ('0' + d.getHours()).slice(-2);
    var mi = ('0' + d.getMinutes()).slice(-2);
    return mm + '-' + dd + ' ' + hh + ':' + mi;
  }

  function saveCurrent() {
    if (!state.result) {
      toast('还没有结果可以保存');
      return;
    }
    var snap = CF.snapshot(state.result);
    state.history.unshift(snap);
    if (state.history.length > 30) state.history.length = 30;
    persistHistory();
    renderHistory();

    if (state.storeOk) {
      toast('已保存到历史记录（' + state.history.length + ' 条）');
    } else {
      toast('浏览器禁止了本地存储，记录只在本次会话有效');
    }
  }

  function renderHistory() {
    var list = $('#historyList');
    var empty = $('#historyEmpty');
    var trendCard = $('#trendCard');
    if (!list) return;

    if (!state.history.length) {
      list.classList.add('is-hidden');
      if (empty) empty.classList.remove('is-hidden');
      if (trendCard) trendCard.classList.add('is-hidden');
      return;
    }

    list.classList.remove('is-hidden');
    if (empty) empty.classList.add('is-hidden');

    list.innerHTML = state.history.map(function (item, index) {
      var grade = CF.gradeOf(item.total);
      return '<div class="hist-item">' +
        '<div><p class="hist-date">' + dateText(item.ts) + '</p>' +
        '<p class="hist-total">' + CF.tonsText(item.total, 2) + '<small>t</small></p></div>' +
        '<div class="hist-side">' +
        '<span class="hist-grade" style="background:' + grade.color + '">' + item.grade + '</span>' +
        '<button class="hist-del" data-index="' + index + '" aria-label="删除这条记录">删除</button>' +
        '</div>' +
        '</div>';
    }).join('');

    $$('.hist-del', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-index'));
        state.history.splice(idx, 1);
        persistHistory();
        renderHistory();
        toast('已删除一条记录');
      });
    });

    if (trendCard) trendCard.classList.remove('is-hidden');
    renderTrend();
  }

  function renderTrend() {
    var el = $('#trendChart');
    if (!el) return;
    var data = state.history.slice(0, 8).slice().reverse();
    if (data.length < 2) {
      el.innerHTML = '<p style="color:#94a3b8;font-size:.8rem;text-align:center;padding-top:40px">至少保存 2 次才能看趋势</p>';
      return;
    }
    // 同一天存的记录，横轴改用「时:分:秒」，避免标签全变成同一个日期
    var dayKeys = {};
    data.forEach(function (d) { dayKeys[new Date(d.ts).toDateString()] = 1; });
    var sameDay = Object.keys(dayKeys).length < data.length;

    function pad2(n) { return ('0' + n).slice(-2); }

    var labels = data.map(function (d) {
      var t = new Date(d.ts);
      if (!sameDay) return pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
      return pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds());
    });
    var values = data.map(function (d) { return Number((d.total / 1000).toFixed(2)); });
    if (CF.charts) CF.charts.line(el, labels, values);
  }

  function openDrawer() {
    var drawer = $('#historyDrawer');
    var backdrop = $('#drawerBackdrop');
    if (!drawer) return;
    renderHistory();
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.classList.add('is-open');
  }

  function closeDrawer() {
    var drawer = $('#historyDrawer');
    var backdrop = $('#drawerBackdrop');
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.classList.remove('is-open');
  }

  /* =======================================================
     分享卡片（Canvas）
     ======================================================= */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var line = '';
    var lines = [];
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = text[i];
        if (lines.length === maxLines - 1) break;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.forEach(function (t, i) { ctx.fillText(t, x, y + i * lineHeight); });
  }

  var FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif';

  function drawCard(r) {
    var cv = $('#shareCanvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = 720, H = 960;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* 背景 */
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#04291f');
    g.addColorStop(0.55, '#065f46');
    g.addColorStop(1, '#0f766e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(640, 90, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(60, 880, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 标题 */
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 20px ' + FONT;
    ctx.fillText('我 的 年 度 碳 足 迹', 56, 92);

    /* 大数字 */
    var totalT = CF.tonsText(r.total, 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 132px ' + FONT;
    ctx.fillText(totalT, 50, 236);
    var numW = ctx.measureText(totalT).width;
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 26px ' + FONT;
    ctx.fillText('吨 CO₂e / 年', 56 + numW + 12, 236);

    /* 等级 */
    ctx.save();
    ctx.fillStyle = r.grade.color;
    roundRect(ctx, 528, 136, 120, 120, 32);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '800 54px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(r.grade.grade, 588, 214);
    ctx.font = '600 18px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(r.grade.title, 588, 296);
    ctx.textAlign = 'left';
    ctx.restore();

    /* 评价 */
    ctx.fillStyle = 'rgba(255,255,255,.86)';
    ctx.font = '400 21px ' + FONT;
    var line1 = '比全国人均低 ' + Math.max(0, (1 - r.total / 8000) * 100).toFixed(0) + '%';
    var line2 = '比全球人均低 ' + Math.max(0, (1 - r.total / 4700) * 100).toFixed(0) + '%';
    var line3 = r.total <= 2000 ? '已达巴黎协定目标线' : '巴黎目标的 ' + (r.total / 2000).toFixed(2) + ' 倍';
    ctx.fillText(line1 + '  ·  ' + line2 + '  ·  ' + line3, 56, 340);

    /* 分隔线 */
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(56, 372);
    ctx.lineTo(W - 56, 372);
    ctx.stroke();

    /* 分项条形 */
    var maxKg = r.items.reduce(function (m, it) { return Math.max(m, it.kg); }, 1);
    r.items.forEach(function (it, i) {
      var y = 420 + i * 74;
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.font = '600 22px ' + FONT;
      ctx.fillText(it.icon + ' ' + it.label, 56, y);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      roundRect(ctx, 176, y - 16, 380, 14, 7);
      ctx.fill();
      var w = Math.max(6, (it.kg / maxKg) * 380);
      ctx.fillStyle = it.color;
      roundRect(ctx, 176, y - 16, w, 14, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 20px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(CF.tonsText(it.kg, 2) + ' t', W - 56, y);
      ctx.textAlign = 'left';
    });

    /* 三条基准：分三列排，避免手动空格对齐 */
    var bench = [['全国人均', '8.00 t'], ['全球人均', '4.70 t'], ['巴黎目标', '2.00 t']];
    bench.forEach(function (b, i) {
      var x = 56 + i * 212;
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.font = '500 17px ' + FONT;
      ctx.fillText(b[0], x, 726);
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.font = '700 26px ' + FONT;
      ctx.fillText(b[1], x, 760);
    });

    /* 页脚 */
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath();
    ctx.moveTo(56, 800);
    ctx.lineTo(W - 56, 800);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '700 22px ' + FONT;
    ctx.fillText('减排，从今天的一次选择开始。', 56, 848);

    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '400 17px ' + FONT;
    ctx.fillText('个人碳足迹计算器 · 排放因子法 · 数据只保存在你的浏览器', 56, 888);
  }

  function openCard() {
    if (!state.result) {
      toast('还没有结果可以生成卡片');
      return;
    }
    drawCard(state.result);
    var modal = $('#cardModal');
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeCard() {
    var modal = $('#cardModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function downloadCard() {
    var cv = $('#shareCanvas');
    if (!cv) return;

    function trigger(url) {
      var a = document.createElement('a');
      a.href = url;
      a.download = '我的碳足迹卡片.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (url.indexOf('blob:') === 0) setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('卡片已开始下载');
    }

    if (typeof cv.toBlob === 'function') {
      cv.toBlob(function (blob) {
        if (!blob) { trigger(cv.toDataURL('image/png')); return; }
        trigger(URL.createObjectURL(blob));
      }, 'image/png');
    } else {
      trigger(cv.toDataURL('image/png'));
    }
  }

  /* =======================================================
     事件绑定 & 启动
     ======================================================= */
  function bindGlobal() {
    $$('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () {
        show(el.getAttribute('data-nav'));
      });
    });

    var btnHistory = $('#btnHistory');
    if (btnHistory) btnHistory.addEventListener('click', openDrawer);
    var btnCloseDrawer = $('#btnCloseDrawer');
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
    var backdrop = $('#drawerBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    var btnClear = $('#btnClearHistory');
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (!state.history.length) { toast('还没有记录'); return; }
        state.history = [];
        persistHistory();
        renderHistory();
        toast('已清空全部记录');
      });
    }

    var btnSave = $('#btnSaveHistory');
    if (btnSave) btnSave.addEventListener('click', saveCurrent);

    var btnShare = $('#btnShare');
    if (btnShare) btnShare.addEventListener('click', openCard);

    var btnDownload = $('#btnDownloadCard');
    if (btnDownload) btnDownload.addEventListener('click', downloadCard);

    ['#btnCloseModal', '#btnCloseModal2'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener('click', closeCard);
    });

    var modal = $('#cardModal');
    if (modal) {
      modal.addEventListener('click', function (ev) {
        if (ev.target === modal) closeCard();
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        closeCard();
        closeDrawer();
      }
    });
  }

  function init() {
    if (!CF || !CF.compute) {
      console.error('[碳足迹] 计算模块没有加载成功');
      return;
    }

    loadHistory();
    bindForm();
    bindGlobal();
    setElecMode('direct');
    renderHistory();

    if (CF.charts) {
      CF.charts.ensureLib().then(function (ok) {
        if (ok) refreshCharts();
      });
    }

    show('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
