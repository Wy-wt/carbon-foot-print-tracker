/* =========================================================
   charts.js · 图表
   ---------------------------------------------------------
   优先用 ECharts（CDN，带多个源），拿不到就退化成
   原生 SVG / HTML 图形，保证断网也能正常演示。
   ========================================================= */
window.CF = window.CF || {};

(function (CF) {
  'use strict';

  var CDN_LIST = [
    'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js',
    'https://unpkg.com/echarts@5.5.0/dist/echarts.min.js',
    'https://cdn.staticfile.org/echarts/5.5.0/echarts.min.js',
    'https://lib.baomitu.com/echarts/5.5.0/echarts.min.js'
  ];

  var libPromise = null;
  var instances = [];

  function hasLib() {
    return typeof window.echarts !== 'undefined' && window.echarts && typeof window.echarts.init === 'function';
  }

  function ensureLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve) {
      if (hasLib()) { resolve(true); return; }

      var index = 0;

      function tryNext() {
        if (index >= CDN_LIST.length) { resolve(false); return; }
        var url = CDN_LIST[index++];
        var script = document.createElement('script');
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          if (script.parentNode) script.parentNode.removeChild(script);
          tryNext();
        }, 7000);

        script.src = url;
        script.async = true;
        script.onload = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (hasLib()) resolve(true);
          else tryNext();
        };
        script.onerror = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          tryNext();
        };
        document.head.appendChild(script);
      }

      tryNext();
    });
    return libPromise;
  }

  /* 清空容器，并回收旧的 ECharts 实例 */
  function clear(el) {
    if (!el) return;
    if (el.__chart) {
      try { el.__chart.dispose(); } catch (e) { /* ignore */ }
      el.__chart = null;
      instances = instances.filter(function (c) { return c.el !== el; });
    }
    el.innerHTML = '';
  }

  function mount(el, option) {
    clear(el);
    var chart = window.echarts.init(el, null, { renderer: 'canvas' });
    chart.setOption(option);
    el.__chart = chart;
    instances.push({ el: el, chart: chart });
    return chart;
  }

  /* ---------------- 环形图：分项占比 ---------------- */
  function donut(el, items, total) {
    if (!el) return;
    clear(el);

    var data = items.filter(function (it) { return it.kg > 0; });

    if (hasLib()) {
      mount(el, {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          confine: true,
          backgroundColor: 'rgba(15,23,42,.94)',
          borderWidth: 0,
          padding: [8, 12],
          textStyle: { color: '#f8fafc', fontSize: 12 },
          formatter: function (p) {
            var pct = Number(p.percent || 0).toFixed(1);
            return p.marker + ' ' + p.name + '<br/><b>' + CF.fmt(p.value) + '</b> kg CO₂e · ' + pct + '%';
          }
        },
        series: [{
          type: 'pie',
          radius: ['62%', '86%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          minAngle: 3,
          itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 5,
            itemStyle: { shadowBlur: 16, shadowColor: 'rgba(15,23,42,.22)' }
          },
          data: data.map(function (it) {
            return { name: it.label, value: Math.round(it.kg), itemStyle: { color: it.color } };
          })
        }]
      });
      return;
    }

    /* --- 兜底：原生 SVG 环形图 --- */
    var R = 72, C = 2 * Math.PI * R;
    var offset = 0;
    var svg = '<svg class="fb-donut" viewBox="0 0 200 200" role="img" aria-label="分项占比环形图">' +
      '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="#f1f5f4" stroke-width="30"/>';
    data.forEach(function (it) {
      var share = total > 0 ? it.kg / total : 0;
      var len = Math.max(0, share * C - 2);
      svg += '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + it.color + '" stroke-width="30" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 100 100)">' +
        '<title>' + it.label + ' ' + CF.tonsText(it.kg, 2) + ' t（' + (share * 100).toFixed(1) + '%）</title></circle>';
      offset += share * C;
    });
    svg += '</svg>';
    el.innerHTML = svg;
  }

  /* ---------------- 条形图：与基准线对比 ---------------- */
  function bars(el, rows) {
    if (!el) return;
    clear(el);

    var max = rows.reduce(function (m, r) { return Math.max(m, r.kg); }, 0);
    var axisMax = Math.max(max * 1.28, 1000);

    if (hasLib()) {
      mount(el, {
        backgroundColor: 'transparent',
        grid: { left: 6, right: 64, top: 10, bottom: 6, containLabel: true },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: 'rgba(15,23,42,.94)',
          borderWidth: 0,
          padding: [8, 12],
          textStyle: { color: '#f8fafc', fontSize: 12 },
          formatter: function (params) {
            var p = params[0];
            var row = rows[p.dataIndex] || {};
            return '<b>' + p.name + '</b><br/>' + CF.tonsText(row.kg, 2) + ' 吨 CO₂e / 年' +
              (row.note ? '<br/><span style="opacity:.7">' + row.note + '</span>' : '');
          }
        },
        xAxis: {
          type: 'value',
          max: axisMax,
          splitLine: { lineStyle: { color: '#eef2f0' } },
          axisLabel: { color: '#94a3b8', fontSize: 10, formatter: function (v) { return (v / 1000) + ' t'; } },
          axisLine: { show: false },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'category',
          data: rows.map(function (r) { return r.label; }),
          axisTick: { show: false },
          axisLine: { show: false },
          axisLabel: { color: '#475569', fontSize: 11 }
        },
        series: [{
          type: 'bar',
          barWidth: 16,
          data: rows.map(function (r) {
            return {
              value: Math.round(r.kg),
              itemStyle: {
                color: r.color,
                opacity: r.you ? 1 : 0.62,
                borderRadius: [0, 9, 9, 0]
              }
            };
          }),
          label: {
            show: true,
            position: 'right',
            distance: 6,
            color: '#475569',
            fontSize: 11,
            fontWeight: 600,
            formatter: function (p) { return (p.value / 1000).toFixed(2) + ' t'; }
          }
        }]
      });
      return;
    }

    /* --- 兜底：HTML 条形图 --- */
    var html = '';
    rows.forEach(function (r) {
      var pct = axisMax > 0 ? Math.max(2, (r.kg / axisMax) * 100) : 2;
      html += '<div class="fb-bar-row">' +
        '<span class="fb-bar-label"' + (r.you ? ' style="font-weight:800;color:#059669"' : '') + '>' + r.label + '</span>' +
        '<span class="fb-bar-track"><span class="fb-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + r.color +
        ';opacity:' + (r.you ? 1 : 0.62) + '"></span></span>' +
        '<span class="fb-bar-value">' + CF.tonsText(r.kg, 2) + ' t</span>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  /* ---------------- 折线图：历史趋势 ---------------- */
  function line(el, labels, values) {
    if (!el) return;
    clear(el);

    if (hasLib()) {
      mount(el, {
        backgroundColor: 'transparent',
        grid: { left: 4, right: 12, top: 14, bottom: 4, containLabel: true },
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(15,23,42,.94)',
          borderWidth: 0,
          padding: [8, 12],
          textStyle: { color: '#f8fafc', fontSize: 12 },
          formatter: function (params) {
            var p = params[0];
            return p.name + '<br/><b>' + Number(p.value).toFixed(2) + ' t</b> CO₂e';
          }
        },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 10 }
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#94a3b8', fontSize: 10, formatter: function (v) { return v + ' t'; } },
          splitLine: { lineStyle: { color: '#eef2f0' } }
        },
        series: [{
          type: 'line',
          smooth: true,
          symbolSize: 7,
          data: values,
          lineStyle: { width: 3, color: '#16a34a' },
          itemStyle: { color: '#16a34a', borderColor: '#fff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(22,163,74,.26)' },
                { offset: 1, color: 'rgba(22,163,74,.02)' }
              ]
            }
          }
        }]
      });
      return;
    }

    /* --- 兜底：SVG 折线 --- */
    var W = 320, H = 120, pad = 12;
    var n = values.length;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = Math.max(max - min, 0.5);
    var pts = values.map(function (v, i) {
      var x = n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1);
      var y = H - pad - ((v - min) / span) * (H - pad * 2);
      return [x, y];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - pad) + ' Z';
    var dots = pts.map(function (p) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" fill="#16a34a" stroke="#fff" stroke-width="2"/>';
    }).join('');

    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:100%" role="img" aria-label="趋势折线图">' +
      '<path d="' + area + '" fill="rgba(22,163,74,.14)"/>' +
      '<path d="' + d + '" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + '</svg>';
  }

  /* ---------------- 自适应 ---------------- */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      instances.forEach(function (item) {
        if (item.chart && !item.chart.isDisposed()) {
          try { item.chart.resize(); } catch (e) { /* ignore */ }
        }
      });
    }, 140);
  });

  CF.charts = {
    ensureLib: ensureLib,
    hasLib: hasLib,
    donut: donut,
    bars: bars,
    line: line
  };

})(window.CF);
