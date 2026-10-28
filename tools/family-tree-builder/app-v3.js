/* 家族树 v3 · 全景分层布局版
 * 数据模型：{ id, name, sex, parents[], stepParents[], spouses[], birth, death, deceased, note }
 * 存储键与 v1/v2 共用，数据互通。
 */
(function () {
  'use strict';

  var STORE_KEY = 'jiashu_family_tree_v1';

  /* ================= 数据层 ================= */
  var persons = [];
  var mainId = null;

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(persons)); } catch (e) {}
  }

  function normalizeList(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [], seen = {};
    arr.forEach(function (v) {
      var id = typeof v === 'string' ? v : (v && v.id);
      if (id && !seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }

  function normalizeAll() {
    persons = persons.filter(function (p) { return p && typeof p === 'object'; });
    var ids = {};
    persons.forEach(function (p) { if (p.id) ids[p.id] = 1; });
    persons.forEach(function (p) {
      p.parents = normalizeList(p.parents).filter(function (i) { return ids[i] && i !== p.id; });
      p.stepParents = normalizeList(p.stepParents).filter(function (i) {
        return ids[i] && i !== p.id && p.parents.indexOf(i) < 0;
      });
      p.spouses = normalizeList(p.spouses).filter(function (i) { return ids[i] && i !== p.id; });
      if (p.sex !== 'M' && p.sex !== 'F') p.sex = 'M';
      p.name = (p.name == null ? '' : String(p.name));
      p.birth = p.birth == null ? '' : String(p.birth);
      p.death = p.death == null ? '' : String(p.death);
      p.note = p.note == null ? '' : String(p.note);
      p.deceased = !!p.deceased || !!String(p.death).trim();
    });
    // 配偶双向补齐
    persons.forEach(function (p) {
      p.spouses.forEach(function (sid) {
        var q = getPerson(sid);
        if (q && q.spouses.indexOf(p.id) < 0) q.spouses.push(p.id);
      });
    });
  }

  function load() {
    try { persons = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (e) { persons = []; }
    if (!Array.isArray(persons)) persons = [];
    normalizeAll();
    netLayoutCache = null;
    try { mainId = localStorage.getItem(STORE_KEY + '_main') || null; } catch (e) { mainId = null; }
  }

  function getPerson(id) {
    for (var i = 0; i < persons.length; i++) if (persons[i].id === id) return persons[i];
    return null;
  }
  function idxOf(id) {
    for (var i = 0; i < persons.length; i++) if (persons[i].id === id) return i;
    return -1;
  }
  function childrenOf(id) {
    return persons.filter(function (p) { return p.parents.indexOf(id) >= 0; })
      .map(function (p) { return p.id; });
  }
  function allParentsOf(p) { return p.parents.concat(p.stepParents || []); }
  function sexLabel(s) { return s === 'M' ? '男' : '女'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function newId() { return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  function isDescendantOf(ancestorId, nodeId) {
    var stack = [nodeId], seen = {};
    while (stack.length) {
      var cur = stack.pop();
      if (seen[cur]) continue;
      seen[cur] = 1;
      var kids = childrenOf(cur);
      for (var i = 0; i < kids.length; i++) {
        if (kids[i] === ancestorId) return true;
        stack.push(kids[i]);
      }
    }
    return false;
  }

  /* ================= 代际计算 =================
   * 约束：子女 ≥ 父母 + 1；配偶同代（双向）。
   * 若数据自相矛盾（如同一人既是某人的继父又是其配偶），约束会形成正环 → 无限递增。
   * 处理：迭代超过人数轮仍未收敛即判定为正环，回退为「只按亲子分层 + 配偶一次性对齐」。
   */
  function computeGenerations() {
    var gen = {}, i, n = persons.length;
    if (!n) return gen;

    function parentsOnly() {
      gen = {};
      persons.forEach(function (p) { gen[p.id] = 0; });
      for (var it = 0; it < n + 2; it++) {
        var changed = false;
        for (var k = 0; k < persons.length; k++) {
          var p = persons[k];
          var ps = allParentsOf(p), mx = null;
          for (var j = 0; j < ps.length; j++) {
            var g = gen[ps[j]];
            if (g === undefined) continue;
            if (mx === null || g > mx) mx = g;
          }
          if (mx !== null && gen[p.id] < mx + 1) { gen[p.id] = mx + 1; changed = true; }
        }
        if (!changed) break;
      }
    }

    parentsOnly();

    // 配偶同代（取较大者，保证不违反亲子下界）
    function alignSpouses() {
      persons.forEach(function (p) {
        (p.spouses || []).forEach(function (sid) {
          if (gen[sid] === undefined) return;
          var m = Math.max(gen[p.id], gen[sid]);
          gen[p.id] = m;
          gen[sid] = m;
        });
      });
    }

    // 完整的「亲子 + 配偶」联合求解，检测正环
    var gen2 = {};
    persons.forEach(function (p) { gen2[p.id] = 0; });
    var converged = false;
    for (var it2 = 0; it2 < n + 2; it2++) {
      var changed2 = false;
      for (i = 0; i < persons.length; i++) {
        var p2 = persons[i];
        var ps2 = allParentsOf(p2), mx2 = null;
        for (var j2 = 0; j2 < ps2.length; j2++) {
          var g2 = gen2[ps2[j2]];
          if (g2 === undefined) continue;
          if (mx2 === null || g2 > mx2) mx2 = g2;
        }
        if (mx2 !== null && gen2[p2.id] < mx2 + 1) { gen2[p2.id] = mx2 + 1; changed2 = true; }
      }
      for (i = 0; i < persons.length; i++) {
        var q2 = persons[i];
        for (var k2 = 0; k2 < q2.spouses.length; k2++) {
          var sid2 = q2.spouses[k2];
          if (gen2[sid2] === undefined) continue;
          var m2 = Math.max(gen2[q2.id], gen2[sid2]);
          if (gen2[q2.id] !== m2) { gen2[q2.id] = m2; changed2 = true; }
          if (gen2[sid2] !== m2) { gen2[sid2] = m2; changed2 = true; }
        }
      }
      // 无父母、无配偶但有子女的人（如单亲家长）：紧贴最年幼子女上一代。
      // 关键：有配偶者必须跳过——他们已由「配偶同代」对齐保证正确；若在此处再压低，会与上方
      // 配偶对齐互相振荡（永久不收敛 → 走 fallback），最终把子女压在与父母同代（朱林/朱晓雨 bug 根因）。
      for (i = 0; i < persons.length; i++) {
        var p3 = persons[i];
        if (p3.parents.length || (p3.stepParents || []).length) continue;
        if (p3.spouses && p3.spouses.length) continue;
        var kids3 = childrenOf(p3.id);
        if (!kids3.length) continue;
        var mn = null;
        for (var k3 = 0; k3 < kids3.length; k3++) {
          var kk = gen2[kids3[k3]];
          if (mn === null || kk < mn) mn = kk;
        }
        if (mn !== null && gen2[p3.id] !== mn - 1) { gen2[p3.id] = mn - 1; changed2 = true; }
      }
      if (!changed2) { converged = true; break; }
    }

    if (converged) {
      gen = gen2;
    } else {
      // 矛盾数据（如「既是继父又是配偶」形成正环）：亲子为主、配偶为辅反复松弛，
      // 并保证子女永不低于父母，杜绝「子女与父母同代」。
      parentsOnly();
      for (var fb = 0; fb < n + 2; fb++) {
        alignSpouses();
        var chF = false;
        persons.forEach(function (p) {
          var ps = allParentsOf(p), mx = null;
          for (var j = 0; j < ps.length; j++) { var g = gen[ps[j]]; if (g === undefined) continue; if (mx === null || g > mx) mx = g; }
          if (mx !== null && gen[p.id] < mx + 1) { gen[p.id] = mx + 1; chF = true; }
        });
        if (!chF) break;
      }
    }

    var min = null;
    persons.forEach(function (p) { if (min === null || gen[p.id] < min) min = gen[p.id]; });
    if (min === null) min = 0;
    persons.forEach(function (p) { gen[p.id] -= min; });
    return gen;
  }

  /* ================= 横向顺序（家族 DFS） ================= */
  function computeOrder(gen) {
    var order = {}, counter = 0;
    function take(id) { if (order[id] === undefined) order[id] = counter++; }
    function dfs(id, depth) {
      if (depth > 60 || order[id] !== undefined) return;
      take(id);
      var p = getPerson(id);
      if (!p) return;
      // 配偶紧跟（夫妻相邻）
      p.spouses.forEach(function (sid) { if (getPerson(sid)) take(sid); });
      // 子女
      childrenOf(id)
        .sort(function (a, b) { return idxOf(a) - idxOf(b); })
        .forEach(function (cid) {
          if (order[cid] === undefined) dfs(cid, depth + 1);
        });
    }
    // 从最上代、无父母的成员起（并让有子女者优先，形成主干）
    var roots = persons.filter(function (p) { return allParentsOf(p).length === 0; })
      .sort(function (a, b) {
        var ca = childrenOf(a.id).length, cb = childrenOf(b.id).length;
        if (ca !== cb) return cb - ca;
        return idxOf(a.id) - idxOf(b.id);
      });
    roots.forEach(function (p) { dfs(p.id, 0); });
    persons.forEach(function (p) { if (order[p.id] === undefined) dfs(p.id, 0); });
    return order;
  }

  /* ================= 保序回归（PAVA） ================= */
  function pava(v) {
    var blocks = [];
    for (var i = 0; i < v.length; i++) {
      blocks.push({ s: v[i], n: 1 });
      while (blocks.length > 1) {
        var b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.s / a.n <= b.s / b.n) break;
        blocks.pop(); blocks.pop();
        blocks.push({ s: a.s + b.s, n: a.n + b.n });
      }
    }
    var out = [];
    blocks.forEach(function (b) { for (var k = 0; k < b.n; k++) out.push(b.s / b.n); });
    return out;
  }

  /* ================= 布局 ================= */
  var CARD_W = 112, CARD_H = 44;
  var NET_SENIOR_COLOR = '#2f8f5b';   // 网图「长幼/亲子」线色（性别中立的绿，不用男性蓝）
  var GAP_X = CARD_W + 22;      // 同代最小间距（含卡片宽）
  var ROW_H = 122;
  var PAD = 46;

  // orderOverride（可选）：id -> 该代内的序号。传入时按「用户当前看到的顺序」排版，
  // 供「整理对齐」在手动排过序之后仍然尊重用户顺序、只重算坐标。
  // 注意不能传原始 x：布局要重新算，才能把多余间距压掉、把长辈重新居中到子辈中间。
  function computeLayout(orderOverride) {
    var gen = computeGenerations();
    var baseOrder = computeOrder(gen);
    var order = baseOrder;
    if (orderOverride) {
      order = {};
      persons.forEach(function (p) {
        order[p.id] = orderOverride[p.id] !== undefined ? orderOverride[p.id] : (baseOrder[p.id] || 0);
      });
    }
    var x = {}, y = {};

    var rows = {};
    persons.forEach(function (p) {
      var g = gen[p.id];
      (rows[g] || (rows[g] = [])).push(p.id);
    });
    var gens = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
    gens.forEach(function (g) {
      rows[g].sort(function (a, b) { return (order[a] || 0) - (order[b] || 0); });
      y[g] = g * ROW_H;
    });

    // 初始 x
    gens.forEach(function (g) {
      rows[g].forEach(function (id, i) { x[id] = i * GAP_X; });
    });

    function idealFor(id, dir) {
      var p = getPerson(id), refs = [];
      if (dir === 'down') {
        allParentsOf(p).forEach(function (pid) {
          if (gen[pid] !== undefined && gen[pid] < gen[id] && x[pid] !== undefined) refs.push(x[pid]);
        });
      } else {
        childrenOf(id).forEach(function (cid) {
          if (x[cid] !== undefined) refs.push(x[cid]);
        });
      }
      if (!refs.length) return undefined;
      refs.sort(function (a, b) { return a - b; });
      return refs.length % 2
        ? refs[(refs.length - 1) / 2]
        : (refs[refs.length / 2 - 1] + refs[refs.length / 2]) / 2;
    }

    function relaxRow(ids, dir) {
      var target = {};
      ids.forEach(function (id) {
        var t = idealFor(id, dir);
        if (t !== undefined) target[id] = t;
      });
      // 配偶优先：夫妻必须相邻。后出现的一方跟随先出现的一方（覆盖父母/子女算出的目标）
      ids.forEach(function (id) {
        var p = getPerson(id);
        for (var i = 0; i < p.spouses.length; i++) {
          var sid = p.spouses[i];
          if (gen[sid] !== gen[id] || target[sid] === undefined) continue;
          if ((order[sid] || 0) < (order[id] || 0)) {
            // 我是对方的第几个同代配偶（按顺序），依次右排
            var peers = getPerson(sid).spouses.filter(function (x) {
              return gen[x] === gen[sid] && (order[x] || 0) <= (order[id] || 0);
            }).sort(function (a, b) { return (order[a] || 0) - (order[b] || 0); });
            var k = peers.indexOf(id);
            if (k < 0) k = 0;
            target[id] = target[sid] + (k + 1) * GAP_X;
            break;
          }
        }
      });
      if (!Object.keys(target).length) return;
      var base = ids.map(function (id) {
        return target[id] !== undefined ? target[id] : x[id];
      });
      var z = base.map(function (v, i) { return v - i * GAP_X; });
      var zz = pava(z);
      ids.forEach(function (id, i) { x[id] = zz[i] + i * GAP_X; });
    }

    // 迭代松弛：先「子女靠父母」，再「父母居中于子女」，跑到收敛（最多 12 轮）。
    // 必须收敛——固定 3 轮常常停在「子女刚被拉走、父母还没跟上」的一步，
    // 结果就是长辈明显偏离子辈中心（朱林/朱晓雨那种单链最明显）。
    var prevX = null;
    for (var round = 0; round < 12; round++) {
      for (var gi = 1; gi < gens.length; gi++) relaxRow(rows[gens[gi]], 'down');       // 子女靠父母
      for (var gj = gens.length - 2; gj >= 0; gj--) relaxRow(rows[gens[gj]], 'up');    // 父母靠子女
      var delta = 0;
      if (prevX) {
        persons.forEach(function (p) { var d = Math.abs(x[p.id] - prevX[p.id]); if (d > delta) delta = d; });
      }
      prevX = {};
      persons.forEach(function (p) { prevX[p.id] = x[p.id]; });
      if (delta < 0.5) break;
    }

    // 归一化 + 外框
    var minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    persons.forEach(function (p) {
      if (x[p.id] < minX) minX = x[p.id];
      if (x[p.id] > maxX) maxX = x[p.id];
      if (y[gen[p.id]] > maxY) maxY = y[gen[p.id]];
    });
    if (!isFinite(minX)) { minX = 0; maxX = 0; maxY = 0; }
    // 左留白至少要让开「第N代」标签（treeRailX），否则整理对齐算出的位置渲染时会被再右移一次
    var padL = Math.max(PAD, treeRailX);
    persons.forEach(function (p) { x[p.id] = x[p.id] - minX + padL; });

    var nodes = persons.map(function (p) {
      return { id: p.id, p: p, x: x[p.id], y: y[gen[p.id]] + PAD, gen: gen[p.id] };
    });

    return {
      nodes: nodes, gen: gen,
      w: (maxX - minX) + CARD_W + padL + PAD,
      h: maxY + CARD_H + PAD * 2,
      rows: gens.length
    };
  }

  /* ================= 渲染：连线 ================= */
  function buildConnectors(layout) {
    var byId = {};
    layout.nodes.forEach(function (n) { byId[n.id] = n; });

    var couple = [], kids = [], step = [];

    // 夫妻线
    var seen = {};
    persons.forEach(function (p) {
      p.spouses.forEach(function (sid) {
        var q = getPerson(sid);
        if (!q) return;
        var key = [p.id, sid].sort().join('|');
        if (seen[key]) return;
        seen[key] = 1;
        var a = byId[p.id], b = byId[sid];
        if (!a || !b || Math.abs(a.y - b.y) > 1) return; // 跨代不画横线
        couple.push({ a: a, b: b });
      });
    });

    // 亲子：按父母组合分组，画 T 型总线；每组分配一个家族色（用于区分重叠的家庭）
    var FAM_COLORS = ['#5b8def', '#e0558b', '#2faa72', '#e0932f', '#9b6dd6', '#1fa9b8', '#d6675b', '#6b8f3a', '#c2529b', '#3a7fbf'];
    var famIdx = 0;
    var groups = {}, farLinks = [];
    persons.forEach(function (c) {
      var cn = byId[c.id];
      if (!cn) return;
      var ps = c.parents.filter(function (pid) { return byId[pid]; });
      if (!ps.length) return;
      var key = ps.slice().sort().join('|');
      if (!groups[key]) groups[key] = { parents: ps.map(function (id) { return byId[id]; }), kids: [], color: FAM_COLORS[famIdx++ % FAM_COLORS.length] };
      groups[key].kids.push(cn);
    });
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var pxs = g.parents.map(function (n) { return n.x + CARD_W / 2; });
      var parentBottom = Math.max.apply(null, g.parents.map(function (n) { return n.y + CARD_H; }));
      var busX = pxs.reduce(function (a, b) { return a + b; }, 0) / pxs.length;

      // 被配偶吸走、离父母很远的子女：单独用虚线弧表示，避免长横线横穿全图
      // 阈值取 3 张卡宽左右：主干分支（如爸爸）仍走实线，只有真正被拉走的（如嫁入的妻子）才用虚线
      var near = [], far = [];
      g.kids.forEach(function (k) {
        if (Math.abs(k.x + CARD_W / 2 - busX) > 420) far.push(k); else near.push(k);
      });
      far.forEach(function (k) {
        farLinks.push({ fromX: busX, fromY: parentBottom, toX: k.x + CARD_W / 2, toY: k.y, color: g.color });
      });
      if (!near.length) return;

      var xs = near.map(function (k) { return k.x + CARD_W / 2; });
      var minK = Math.min.apply(null, xs.concat([busX]));
      var maxK = Math.max.apply(null, xs.concat([busX]));
      var minKidTop = Math.min.apply(null, near.map(function (k) { return k.y; }));
      var busY = Math.max(parentBottom + 22, Math.min(parentBottom + 52, minKidTop - 26));
      kids.push({
        busX: busX, busY: busY, parentBottom: parentBottom,
        lineLeft: minK, lineRight: maxK, color: g.color,
        kids: near.map(function (k) { return { cx: k.x + CARD_W / 2, y: k.y }; })
      });
    });

    // 继亲：虚线
    persons.forEach(function (c) {
      var cn = byId[c.id];
      if (!cn) return;
      (c.stepParents || []).forEach(function (pid) {
        var pn = byId[pid];
        if (!pn) return;
        step.push({ x1: pn.x + CARD_W / 2, y1: pn.y + CARD_H, x2: cn.x + CARD_W / 2, y2: cn.y });
      });
    });

    return { couple: couple, kids: kids, step: step, far: farLinks };
  }

  /* ================= 渲染：卡片 ================= */
  function subLabel(p) {
    var bits = [sexLabel(p.sex)];
    if (p.birth) bits.push(p.birth);
    if (p.deceased) {
      bits = [sexLabel(p.sex)];
      var span = (p.birth || '?') + '–' + (p.death || '?');
      bits.push(span);
    }
    return bits.join(' · ');
  }

  function cardSvg(n) {
    var p = n.p;
    var dead = p.deceased;
    var color = p.sex === 'M' ? '#2f6fed' : '#e0558b';
    var stroke = dead ? '#b9bfc7' : color;
    var fill = dead ? '#f2f3f5' : '#ffffff';
    var nameColor = dead ? '#6b7280' : '#1f2329';
    var nm = p.name.length > 7 ? p.name.slice(0, 7) + '…' : p.name;
    var title = p.name + ' · ' + sexLabel(p.sex)
      + (p.birth ? ' · 生 ' + p.birth : '')
      + (p.deceased ? ' · 已故' + (p.death ? ' ' + p.death : '') : '')
      + (p.note ? ' · ' + p.note : '');
    var cls = 'tnode' + (dead ? ' dead' : '') + (treeDrag && treeDrag.id === p.id ? ' dragging' : '');
    return '<g class="' + cls + '" data-nodeid="' + p.id + '">'
      + '<title>' + esc(title) + '</title>'
      + '<rect class="box" x="' + n.x + '" y="' + n.y + '" rx="9" width="' + CARD_W + '" height="' + CARD_H + '"'
      + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"'
      + (dead ? ' stroke-dasharray="4 3"' : '') + '></rect>'
      + '<text x="' + (n.x + CARD_W / 2) + '" y="' + (n.y + 19) + '" text-anchor="middle" font-size="13.5" font-weight="600" fill="' + nameColor + '">'
      + esc(nm) + (dead ? ' †' : '') + '</text>'
      + '<text x="' + (n.x + CARD_W / 2) + '" y="' + (n.y + 34) + '" text-anchor="middle" font-size="10.5" fill="' + (dead ? '#9aa0a8' : '#8a9099') + '">'
      + esc(subLabel(p)) + '</text>'
      + '</g>';
  }

  var lastLayout = null;
  var viewMode = 'tree';   // 'tree' | 'net'
  var view = { k: 1, tx: 0, ty: 0 };
  var netPos = {};         // id -> {x,y}  网图手动拖拽位置（覆盖力导向结果）
  var treeOffset = {};     // id -> dx     树形「用户意图锚点」偏移（只有直接拖动才写入，让位结果不写入）
  var treeDrag = null;     // 拖拽中：{ id, rowY, want:{id:x}, base:{id:x}, display:{id:x}, eased:{id:x} }
  var netLayoutCache = null; // 力导向布局缓存，避免拖拽时每帧重算导致抖动
  var treeRailX = 46;        // 卡片左边界（左侧「第N代」标签文字宽度 + 呼吸），随代数动态更新
  var renderCount = 0;       // 重绘次数（供验证「每帧最多重绘一次」）

  // 真实内容边界（含手动偏移与拖拽让位），供布局宽高与「适应窗口」使用
  function measureBounds(layout) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    layout.nodes.forEach(function (n) {
      if (n.x < minX) minX = n.x;
      if (n.x + CARD_W > maxX) maxX = n.x + CARD_W;
      if (n.y < minY) minY = n.y;
      if (n.y + CARD_H > maxY) maxY = n.y + CARD_H;
    });
    if (!isFinite(minX)) { minX = 0; maxX = CARD_W; minY = 0; maxY = CARD_H; }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  // 整行左边界约束：拖动让位时最左卡片可能被推进左侧标签区，
  // 整行右移补回来——保证「卡片永远不会压住/越过第N代标签」。
  function clampRowsToRail(layout) {
    var rows = {};
    layout.nodes.forEach(function (n) { (rows[n.gen] || (rows[n.gen] = [])).push(n); });
    Object.keys(rows).forEach(function (g) {
      var arr = rows[g], minx = Infinity;
      arr.forEach(function (n) { if (n.x < minx) minx = n.x; });
      if (!isFinite(minx) || minx >= treeRailX - 0.01) return;
      var d = treeRailX - minx;
      arr.forEach(function (n) {
        n.x += d;
        if (treeDrag && treeDrag.display && treeDrag.display[n.id] !== undefined) treeDrag.display[n.id] += d;
        if (treeDrag && treeDrag.eased && treeDrag.eased[n.id] !== undefined) treeDrag.eased[n.id] += d;
      });
    });
  }

  // 手动布局持久化：网图拖拽位置 + 树形水平偏移分别存盘，刷新后保留
  function loadManualLayout() {
    try {
      var n = JSON.parse(localStorage.getItem('jiashu_net_layout') || '{}');
      if (n && typeof n === 'object') netPos = n;
    } catch (e) { netPos = {}; }
    try {
      var t = JSON.parse(localStorage.getItem('jiashu_tree_offsets') || '{}');
      if (t && typeof t === 'object') treeOffset = t;
    } catch (e) { treeOffset = {}; }
  }
  function saveManualLayout() {
    try { localStorage.setItem('jiashu_net_layout', JSON.stringify(netPos)); } catch (e) {}
    try { localStorage.setItem('jiashu_tree_offsets', JSON.stringify(treeOffset)); } catch (e) {}
  }

  function renderTree() {
    renderCount++;
    if (viewMode === 'net') { renderNetView(); return; }
    var svg = document.getElementById('treeSvg');
    var vp = document.getElementById('viewport');
    var emptyTip = document.getElementById('emptyTip');
    var stat = document.getElementById('treeStat');
    vp.innerHTML = '';
    hideMenu();

    if (!persons.length) {
      lastLayout = null;
      emptyTip.classList.remove('hidden');
      stat.textContent = '';
      updateZoomLabel();
      return;
    }
    emptyTip.classList.add('hidden');

    // 左侧「第N代」标签占位：标签自 x=6 起、12px 字号，文字宽度 + 呼吸间距 = 卡片允许的最左边界。
    // 必须在布局之前算好——布局的左侧留白要用它，否则「整理对齐」算出的位置会被再右移一次。
    var genPre = computeGenerations(), maxGen = 0;
    persons.forEach(function (p) { var gg = genPre[p.id] || 0; if (gg > maxGen) maxGen = gg; });
    treeRailX = 6 + String('第' + (maxGen + 1) + '代').length * 15 + 12;

    var layout = computeLayout();
    // 叠加树形「同代内水平调整」偏移（点击拖动节点产生）
    layout.nodes.forEach(function (n) {
      var dx = treeOffset[n.id];
      if (dx) n.x += dx;
    });
    // 拖拽中：按「拖动者钉住 + 其余单向让位」重算本代显示位置（临时层，松手才落盘）
    applyTreeDragPack(layout);
    // 任何情况下整行都不得侵入左侧世代标签区（持久化的偏移同样受此约束）
    clampRowsToRail(layout);
    lastLayout = layout;
    // 用「实际显示位置」量真实边界：树形内容可能被手动拖出手动布局的范围，
    // 按自动布局的 w/h 算会让「适应窗口」缩错。
    layout.bounds = measureBounds(layout);
    layout.bounds.minX = 0;   // 「第N代」标签从 x=0 起画，必须算进内容边界，否则「适应」会把它裁出画布
    layout.w = Math.max(layout.bounds.maxX, treeRailX + CARD_W) + PAD;
    layout.h = layout.bounds.maxY + PAD;
    var conn = buildConnectors(layout);

    // 世代背景带 + 左侧世代标签（仅在树形视图）
    var genY = {};
    layout.nodes.forEach(function (n) { genY[n.gen] = n.y; });
    var gensSorted = Object.keys(genY).map(Number).sort(function (a, b) { return a - b; });
    var bandsOut = [];
    gensSorted.forEach(function (g) {
      var top = genY[g] - 12;
      bandsOut.push('<rect x="0" y="' + top + '" width="' + layout.w + '" height="' + (CARD_H + 24) + '" fill="'
        + ((g % 2 === 0) ? 'rgba(47,111,237,0.045)' : 'rgba(224,85,139,0.045)') + '"></rect>');
    });
    var labelOut = [];
    gensSorted.forEach(function (g) {
      labelOut.push('<text x="8" y="' + (genY[g] + CARD_H / 2 + 5) + '" font-size="15" font-weight="700" fill="#8b929c">第' + (g + 1) + '代</text>');
    });
    var out = bandsOut.slice();

    // 夫妻线：用弧线，跨距越大拱越高 —— 一夫多妻时多条线不会叠成一条
    conn.couple.forEach(function (c) {
      var left = c.a.x < c.b.x ? c.a : c.b;
      var right = c.a.x < c.b.x ? c.b : c.a;
      var y = c.a.y + CARD_H / 2;
      var xa = left.x + CARD_W, xb = right.x;
      if (xb < xa) { xa = left.x + CARD_W / 2; xb = right.x + CARD_W / 2; }
      var span = xb - xa;
      if (span <= 26) {
        out.push('<line x1="' + xa + '" y1="' + y + '" x2="' + xb + '" y2="' + y
          + '" stroke="#c1c7d0" stroke-width="2" stroke-linecap="round"></line>');
      } else {
        var h = Math.min(8 + span / 5, 38);
        out.push('<path d="M' + xa + ' ' + y + ' Q' + ((xa + xb) / 2) + ' ' + (y - h) + ' ' + xb + ' ' + y
          + '" fill="none" stroke="#c1c7d0" stroke-width="2" stroke-linecap="round"></path>');
      }
    });

    // 亲子 T 线（按家庭配色，便于在重叠处区分不同父母的子女）
    conn.kids.forEach(function (g) {
      var col = g.color || '#b9c0c9';
      out.push('<path d="M' + g.busX + ' ' + g.parentBottom + ' L' + g.busX + ' ' + g.busY
        + ' M' + g.lineLeft + ' ' + g.busY + ' L' + g.lineRight + ' ' + g.busY
        + '" fill="none" stroke="' + col + '" stroke-width="1.9" stroke-linecap="round"></path>');
      g.kids.forEach(function (k) {
        out.push('<path d="M' + k.cx + ' ' + g.busY + ' L' + k.cx + ' ' + k.y
          + '" fill="none" stroke="' + col + '" stroke-width="1.9" stroke-linecap="round"></path>');
      });
    });

    // 被配偶吸走的子女（如妻子跟着丈夫，跨集群）：家庭色虚线弧 + 两端圆点，连回其亲生父母总线
    conn.far.forEach(function (f) {
      var col = f.color || '#c9ced6';
      var dy = Math.max(30, (f.toY - f.fromY) / 2);
      out.push('<path d="M' + f.fromX + ' ' + f.fromY
        + ' C' + f.fromX + ' ' + (f.fromY + dy) + ' ' + f.toX + ' ' + (f.toY - dy) + ' ' + f.toX + ' ' + f.toY
        + '" fill="none" stroke="' + col + '" stroke-width="1.7" stroke-dasharray="6 4" stroke-linecap="round"></path>');
      out.push('<circle cx="' + f.fromX + '" cy="' + f.fromY + '" r="2.8" fill="' + col + '"></circle>');
      out.push('<circle cx="' + f.toX + '" cy="' + f.toY + '" r="2.8" fill="' + col + '"></circle>');
    });

    // 继亲虚线
    conn.step.forEach(function (s) {
      out.push('<path d="M' + s.x1 + ' ' + s.y1 + ' C' + s.x1 + ' ' + (s.y1 + 30) + ' '
        + s.x2 + ' ' + (s.y2 - 30) + ' ' + s.x2 + ' ' + s.y2
        + '" fill="none" stroke="#b0b6be" stroke-width="1.4" stroke-dasharray="5 4"></path>');
    });

    // 卡片
    layout.nodes.forEach(function (n) { out.push(cardSvg(n)); });

    // 世代标签置于最上层（左侧留白区，不与卡片重叠）
    out = out.concat(labelOut);

    vp.innerHTML = out.join('');

    // 不设 viewBox：内容坐标即像素坐标，缩放/平移由 <g id="viewport"> 的 transform 完成。
    // （若同时用 viewBox 固定内容尺寸，transform 放大后会超出 viewBox 被裁掉）
    svg.removeAttribute('viewBox');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    stat.textContent = '共 ' + persons.length + ' 人 · ' + layout.rows + ' 代';

    applyView();
  }

  /* ================= 网图布局（力导向） ================= */
  function computeNetLayout() {
    var n = persons.length;
    var gen = computeGenerations();
    var pos = {}, i;
    persons.forEach(function (p, idx) {
      var ang = (idx / Math.max(n, 1)) * Math.PI * 2;
      var r = 90 + 30 * Math.sqrt(n);
      pos[p.id] = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
    });
    var edges = [];
    persons.forEach(function (p) {
      allParentsOf(p).forEach(function (pid) { if (getPerson(pid)) edges.push({ a: p.id, b: pid, w: 1.0 }); });
      (p.spouses || []).forEach(function (sid) { if (getPerson(sid)) edges.push({ a: p.id, b: sid, w: 0.7 }); });
    });
    var k = 96;
    var temp = 1.0;
    var iters = 280;
    for (var it = 0; it < iters; it++) {
      var disp = {};
      persons.forEach(function (p) { disp[p.id] = { x: 0, y: 0 }; });
      for (i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var A = persons[i].id, B = persons[j].id;
          var dx = pos[A].x - pos[B].x, dy = pos[A].y - pos[B].y;
          var d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy; }
          var d = Math.sqrt(d2);
          var rep = (k * k) / d;
          disp[A].x += dx / d * rep; disp[A].y += dy / d * rep;
          disp[B].x -= dx / d * rep; disp[B].y -= dy / d * rep;
        }
      }
      edges.forEach(function (e) {
        var A = pos[e.a], B = pos[e.b];
        var dx = A.x - B.x, dy = A.y - B.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var attr = (d * d / k) * e.w;
        disp[e.a].x -= dx / d * attr; disp[e.a].y -= dy / d * attr;
        disp[e.b].x += dx / d * attr; disp[e.b].y += dy / d * attr;
      });
      persons.forEach(function (p) {
        var c = pos[p.id];
        disp[p.id].x += -c.x * 0.015; disp[p.id].y += -c.y * 0.015;
      });
      persons.forEach(function (p) {
        var c = pos[p.id], dd = disp[p.id];
        var dl = Math.sqrt(dd.x * dd.x + dd.y * dd.y) || 0.01;
        var lim = Math.min(dl, temp * k);
        c.x += dd.x / dl * lim; c.y += dd.y / dl * lim;
      });
      temp *= 0.985;
    }
    // 碰撞避让：保证任意两节点中心距不小于 minDist，避免卡片互相重叠（留出躲避空间）
    var minDist = CARD_W + 30;
    for (var ci = 0; ci < 140; ci++) {
      for (i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var A = persons[i].id, B = persons[j].id;
          var dx = pos[A].x - pos[B].x, dy = pos[A].y - pos[B].y;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          if (d < minDist) {
            var push = (minDist - d) / 2 + 0.5;
            var ux = dx / d, uy = dy / d;
            pos[A].x += ux * push; pos[A].y += uy * push;
            pos[B].x -= ux * push; pos[B].y -= uy * push;
          }
        }
      }
    }
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    persons.forEach(function (p) {
      var c = pos[p.id];
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    });
    var PAD = 60;
    if (!isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
    persons.forEach(function (p) {
      pos[p.id].x += (-minX + PAD);
      pos[p.id].y += (-minY + PAD);
    });
    var nodes = persons.map(function (p) {
      return { id: p.id, p: p, x: pos[p.id].x, y: pos[p.id].y, gen: gen[p.id] };
    });
    return { nodes: nodes, gen: gen, w: (maxX - minX) + CARD_W + PAD * 2, h: (maxY - minY) + CARD_H + PAD * 2, rows: 1 };
  }

  // 沿单位方向 (ux,uy) 从卡片中心到「外扩 pad 的矩形」边界的距离
  function rectHit(ux, uy, pad) {
    var hx = CARD_W / 2 + (pad || 0), hy = CARD_H / 2 + (pad || 0);
    var tx = Math.abs(ux) < 1e-6 ? Infinity : hx / Math.abs(ux);
    var ty = Math.abs(uy) < 1e-6 ? Infinity : hy / Math.abs(uy);
    return Math.min(tx, ty);
  }

  // 线段贴边裁剪（参考 ggraph 的 start_cap / end_cap、ggnet2 的 arrow.gap）：
  // 端点落在「卡片外扩 gap 的矩形」上，保证离卡片边框恒定 ≥ gap（斜向也不塌），
  // 卡片遮不住箭头，多个父母也从不同方位抵达，不再挤在节点同一点。
  function edgePoints(a, b, gapA, gapB) {
    var ax = a.x + CARD_W / 2, ay = a.y + CARD_H / 2;
    var bx = b.x + CARD_W / 2, by = b.y + CARD_H / 2;
    var dx = bx - ax, dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-3) return { x1: ax, y1: ay, x2: bx, y2: by };
    var ux = dx / len, uy = dy / len;
    var tA = rectHit(ux, uy, gapA);
    var tB = rectHit(-ux, -uy, gapB);
    if (len - (tA + tB) < 8) { tA = len * 0.35; tB = len * 0.35; }  // 两卡过近：等比截取，避免线反向
    return {
      x1: ax + ux * tA, y1: ay + uy * tA,
      x2: bx - ux * tB, y2: by - uy * tB
    };
  }

  function netEdge(a, b, color, w, dash, marker) {
    var p = edgePoints(a, b, 1, marker ? 8 : 1);
    return '<line x1="' + p.x1 + '" y1="' + p.y1 + '" x2="' + p.x2 + '" y2="' + p.y2
      + '" stroke="' + color + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '')
      + (marker ? ' marker-end="url(#' + marker + ')"' : '') + ' stroke-linecap="round"></line>';
  }

  // 长幼（亲子）连线：贴子节点边框外 8px 收尾，箭头指向子代（长辈→晚辈），性别中立绿
  function netEdgeSenior(a, b) {
    return netEdge(a, b, NET_SENIOR_COLOR, 1.6, null, 'netArrow');
  }

  function getNetLayout() {
    if (!netLayoutCache) netLayoutCache = computeNetLayout();
    // 应用用户手动拖拽出的位置（覆盖力导向结果）
    netLayoutCache.nodes.forEach(function (n) {
      var o = netPos[n.id];
      if (o && typeof o.x === 'number' && typeof o.y === 'number') { n.x = o.x; n.y = o.y; }
    });
    return netLayoutCache;
  }

  function renderNetView() {
    var svg = document.getElementById('treeSvg');
    var vp = document.getElementById('viewport');
    var emptyTip = document.getElementById('emptyTip');
    var stat = document.getElementById('treeStat');
    vp.innerHTML = '';
    hideMenu();
    if (!persons.length) {
      lastLayout = null; emptyTip.classList.remove('hidden'); stat.textContent = '';
      updateZoomLabel(); return;
    }
    emptyTip.classList.add('hidden');
    var layout = getNetLayout();
    // 手动拖过的节点可能跑到力导向范围之外，按实际位置重算包围盒，保证「适应」不缩错
    var nb = measureBounds(layout);
    layout.bounds = nb;
    layout.w = nb.maxX + 60;
    layout.h = nb.maxY + 60;
    lastLayout = layout;
    var byId = {};
    layout.nodes.forEach(function (m) { byId[m.id] = m; });
    var out = ['<defs><marker id="netArrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + NET_SENIOR_COLOR + '"></path></marker></defs>'];
    // 继亲：虚线（最后画，置于底层）
    persons.forEach(function (c) {
      (c.stepParents || []).forEach(function (pid) {
        var a = byId[pid], b = byId[c.id]; if (!a || !b) return;
        out.push(netEdge(a, b, '#b0b6be', 1.4, '5 4'));
      });
    });
    // 配偶：灰实线
    var seen = {};
    persons.forEach(function (p) {
      (p.spouses || []).forEach(function (sid) {
        var key = [p.id, sid].sort().join('|');
        if (seen[key]) return; seen[key] = 1;
        var a = byId[p.id], b = byId[sid]; if (!a || !b) return;
        out.push(netEdge(a, b, '#c1c7d0', 1.8, null));
      });
    });
    // 亲子：绿箭头线（长辈→晚辈，性别中立色，置于上层）
    persons.forEach(function (c) {
      var b = byId[c.id]; if (!b) return;
      (c.parents || []).forEach(function (pid) {
        var a = byId[pid]; if (!a) return;
        out.push(netEdgeSenior(a, b));
      });
    });
    // 卡片
    layout.nodes.forEach(function (m) { out.push(cardSvg(m)); });
    vp.innerHTML = out.join('');
    svg.removeAttribute('viewBox');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    stat.textContent = '共 ' + persons.length + ' 人 · 网图（可拖动节点 · 绿箭头=亲子/长幼 灰=配偶 虚线=继亲）';
    applyView();
  }

  /* ================= 视图：缩放 / 拖拽 ================= */
  function applyView() {
    var vp = document.getElementById('viewport');
    if (vp) vp.setAttribute('transform', 'translate(' + view.tx + ',' + view.ty + ') scale(' + view.k + ')');
    updateZoomLabel();
  }
  function updateZoomLabel() {
    var el = document.getElementById('zoomLabel');
    if (el) el.textContent = Math.round(view.k * 100) + '%';
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function zoomAt(px, py, factor) {
    var k2 = clamp(view.k * factor, 0.18, 3);
    var r = k2 / view.k;
    view.tx = px - (px - view.tx) * r;
    view.ty = py - (py - view.ty) * r;
    view.k = k2;
    applyView();
  }

  /* ---- 树形同代拖动：拖动者跟手 + 其余按 1D 区间打包单向让位（Observable Plot dodge / Force-Scan 思路）----
     关键：让位结果是「临时显示层」，不写回 treeOffset。否则被推开的卡片会把「被推开后的位置」
     当成新锚点，拖动者永远追不上它 → 无法越过同辈成员。松手时才把显示位置一次性提交为锚点。 */

  var TREE_GAP = 14;

  function beginTreeDrag(id) {
    var base = computeLayout();
    var rowY = null;
    base.nodes.forEach(function (n) { if (n.id === id) rowY = n.y; });
    if (rowY === null) return false;
    treeDrag = { id: id, rowY: rowY, want: {}, base: {}, display: {}, eased: {}, moved: false };
    base.nodes.forEach(function (n) {
      if (Math.abs(n.y - rowY) >= 1) return;
      treeDrag.base[n.id] = n.x;
      treeDrag.want[n.id] = n.x + (treeOffset[n.id] || 0);   // 拖拽期锚点快照（不含本次让位结果）
    });
    return true;
  }

  // 按当前 want 排序后打包：拖动者钉在 want 处，右侧只许右推、左侧只许左推。
  // 两处体验优化：
  //  1) 左侧边界：拖动者左边已有 i0 个同辈，它们最少占 i0*(卡宽+间距)，所以拖动者不会越过世代标签；
  //  2) 缓动：被让位的同辈按 0.42 的比例「滑」过去，而不是一帧瞬移（拖动者本身严格跟手）。
  function applyTreeDragPack(layout) {
    if (!treeDrag) return;
    var arr = layout.nodes.filter(function (n) {
      return Math.abs(n.y - treeDrag.rowY) < 1 && treeDrag.want[n.id] !== undefined;
    });
    if (!arr.length) return;
    arr.sort(function (a, b) { return treeDrag.want[a.id] - treeDrag.want[b.id]; });
    var i0 = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === treeDrag.id) { i0 = i; break; }
    if (i0 < 0) return;

    var minWant = treeRailX + i0 * (CARD_W + TREE_GAP);
    var dw = treeDrag.want[treeDrag.id];
    if (dw < minWant) { dw = minWant; treeDrag.want[treeDrag.id] = minWant; }

    var target = {};
    target[treeDrag.id] = dw;                               // 拖动者跟手
    var limit = dw + CARD_W + TREE_GAP;
    for (var j = i0 + 1; j < arr.length; j++) {
      target[arr[j].id] = Math.max(treeDrag.want[arr[j].id], limit);
      limit = target[arr[j].id] + CARD_W + TREE_GAP;
    }
    limit = dw - CARD_W - TREE_GAP;
    for (var k = i0 - 1; k >= 0; k--) {
      target[arr[k].id] = Math.min(treeDrag.want[arr[k].id], limit);
      limit = target[arr[k].id] - CARD_W - TREE_GAP;
    }

    arr.forEach(function (n) {
      var t = target[n.id];
      if (n.id === treeDrag.id) { n.x = t; treeDrag.eased[n.id] = t; return; }
      var prev = treeDrag.eased[n.id];
      // 首次出现、或需要跨过一整个身位（换位）时直接到位，避免横穿别人的尴尬中间态
      if (prev === undefined || Math.abs(prev - t) > CARD_W * 1.6) { n.x = t; treeDrag.eased[n.id] = t; return; }
      var nx = prev + (t - prev) * 0.42;
      if (Math.abs(t - nx) < 0.8) nx = t;
      n.x = nx; treeDrag.eased[n.id] = nx;
    });
    treeDrag.display = target;
  }

  // 是否还有同辈在缓动中（指针停住时继续推进，避免停在半路）
  function treeDragEasing() {
    if (!treeDrag || !treeDrag.eased || !treeDrag.display) return 0;
    var n = 0;
    for (var id in treeDrag.eased) {
      var t = treeDrag.display[id];
      if (t !== undefined && Math.abs(t - treeDrag.eased[id]) > 0.8) n++;
    }
    return n;
  }

  // 松手：把本代最终显示位置提交为锚点（偏移 = 显示位置 - 自动布局位置）
  function endTreeDrag() {
    if (!treeDrag) return false;
    var tg = treeDrag;
    treeDrag = null;
    if (!tg.moved || !tg.display) return false;
    computeLayout().nodes.forEach(function (n) {
      var bx = tg.base[n.id];
      if (bx === undefined) return;
      var dx = (tg.display[n.id] !== undefined ? tg.display[n.id] : bx) - bx;
      if (Math.abs(dx) < 0.5) delete treeOffset[n.id];
      else treeOffset[n.id] = dx;
    });
    renderTree();     // 去掉拖动中的「抬起」样式
    return true;
  }

  // 网图：拖动某节点后，附近重叠节点自动避让。
  // 参考 d3-force 的 forceCollide：先绕拖动者径向推开，再做 2 轮有界成对分离，
  // 避免「被推开的节点彼此又叠上」，同时不改动整图布局（只给受影响的节点建覆盖）。
  function dodgeNetAround(draggedId) {
    var layout = getNetLayout();
    var A = netPos[draggedId];
    if (!A) {
      var dn = null;
      layout.nodes.forEach(function (n) { if (n.id === draggedId) dn = n; });
      if (!dn) return;
      A = netPos[draggedId] = { x: dn.x, y: dn.y };
    }
    var minDist = CARD_W + 30;   // 卡片宽 + 呼吸间距
    var moved = {};

    // 1) 绕拖动者径向推开
    layout.nodes.forEach(function (n) {
      if (n.id === draggedId) return;
      var o = netPos[n.id] || { x: n.x, y: n.y };
      var dx = o.x - A.x, dy = o.y - A.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= minDist) return;
      if (!netPos[n.id]) netPos[n.id] = { x: o.x, y: o.y };
      if (dist < 0.001) { netPos[n.id].x = A.x + minDist; netPos[n.id].y = A.y; }
      else {
        var push = minDist - dist;
        netPos[n.id].x = o.x + (dx / dist) * push;
        netPos[n.id].y = o.y + (dy / dist) * push;
      }
      moved[n.id] = 1;
    });

    // 2) 有界成对分离：只处理本次被推动的节点，避免连锁扩张整张图
    for (var it = 0; it < 2; it++) {
      Object.keys(moved).forEach(function (id) {
        var c = netPos[id];
        if (!c) return;
        layout.nodes.forEach(function (n) {
          if (n.id === id) return;
          var o = netPos[n.id] || { x: n.x, y: n.y };
          var dx = c.x - o.x, dy = c.y - o.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= minDist || d < 0.001) return;
          var need = minDist - d;
          if (n.id === draggedId) {           // 对方是拖动者（钉死）：自己全额退让
            c.x += (dx / d) * need; c.y += (dy / d) * need;
          } else {                             // 双方各退一半
            var half = need / 2;
            c.x += (dx / d) * half; c.y += (dy / d) * half;
            if (!netPos[n.id]) netPos[n.id] = { x: o.x, y: o.y };
            netPos[n.id].x -= (dx / d) * half; netPos[n.id].y -= (dy / d) * half;
            moved[n.id] = 1;
          }
        });
      });
    }
  }

  /* ---- 节点拖动：绝对定位 + rAF 合帧 ----
     旧实现每收到一个 mousemove 就用「增量」累加并整棵重绘：
       · 增量累加会累积浮点误差；
       · 高回报率鼠标（120Hz+）一帧内触发多次整树重绘，丢帧即表现为「跳跃」。
     现在改为：指针位置 -> 绝对目标坐标，且每个动画帧最多重绘一次。 */

  var dragRaf = 0, dragPending = null, dragState = null;

  function queueNodeDrag(st, px, py) {
    dragState = st;
    dragPending = { px: px, py: py };
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(function () {
      dragRaf = 0;
      if (!dragPending || !dragState) return;
      var p = dragPending, s = dragState;
      dragPending = null;
      nodeDragApply(s, p.px, p.py);
    });
  }

  // 落点对齐：把还没渲染的最后一帧立刻应用，保证松手位置 == 指针位置
  function flushNodeDrag() {
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    if (dragPending && dragState) {
      var p = dragPending, s = dragState;
      dragPending = null;
      nodeDragApply(s, p.px, p.py);
    }
  }

  // 拖动单个节点：网图自由(x,y)；树形仅水平(纵向锁定在当前世代)
  function nodeDragApply(st, px, py) {
    if (!st || st.done) return;
    var dx = (px - st.x0) / (view.k || 1);
    var dy = (py - st.y0) / (view.k || 1);
    if (viewMode === 'net') {
      if (!st.startNet) {
        var ly = getNetLayout(), nd = null;
        ly.nodes.forEach(function (m) { if (m.id === st.id) nd = m; });
        if (!nd) return;
        var cur = netPos[st.id] || { x: nd.x, y: nd.y };
        st.startNet = { x: cur.x, y: cur.y };
      }
      netPos[st.id] = { x: st.startNet.x + dx, y: st.startNet.y + dy };
      dodgeNetAround(st.id);
      renderNetView();
      return;
    }
    if (!treeDrag || treeDrag.id !== st.id) {
      if (!beginTreeDrag(st.id)) return;
      st.startWant = treeDrag.want[st.id];
    }
    if (st.startWant === undefined) st.startWant = treeDrag.want[st.id];
    treeDrag.want[st.id] = st.startWant + dx;
    treeDrag.moved = true;
    renderTree();
    if (treeDragEasing()) queueNodeDrag(st, px, py);   // 同辈还在滑动，继续推进到稳定
  }

  // 整理对齐：按用户当前看到的顺序重排坐标 —— 长辈回到子辈中间、把拖出来的多余间距压掉
  function tidyTree() {
    if (viewMode !== 'tree') { toast('整理对齐只在树形视图可用'); return false; }
    if (!persons.length) return false;
    var def = computeLayout();
    var cur = {};
    def.nodes.forEach(function (n) { cur[n.id] = n.x + (treeOffset[n.id] || 0); });

    // 1) 记录当前显示顺序（用户手动排出来的顺序，整理时不能变）
    var rows = {};
    def.nodes.forEach(function (n) { (rows[n.gen] || (rows[n.gen] = [])).push(n); });
    var override = {};
    Object.keys(rows).forEach(function (g) {
      rows[g].sort(function (a, b) { return cur[a.id] - cur[b.id]; });
      rows[g].forEach(function (n, i) { override[n.id] = i; });
    });

    // 2) 用该顺序重新跑一次布局：内部会做「子女找父母 / 父母居中于子女」的迭代 + 一维最小间距打包
    var tidy = computeLayout(override);

    // 3) 把结果换算回相对自动布局的偏移（保持与拖拽同一套持久化机制）
    var baseMap = {};
    def.nodes.forEach(function (n) { baseMap[n.id] = n.x; });
    for (var id in treeOffset) delete treeOffset[id];
    tidy.nodes.forEach(function (n) {
      var d = n.x - baseMap[n.id];
      if (Math.abs(d) >= 0.5) treeOffset[n.id] = d;
    });

    treeDrag = null;
    saveManualLayout();
    renderAll({ fit: true });
    toast('已按当前顺序整理对齐');
    return true;
  }

  // 适应窗口：宽、高两个方向同时贴合，取更紧的那个缩放，让节点尽量铺满画布。
  // 旧版把缩放上限钉在 1.25，人少的族谱永远只占中间一小块；现在按可用空间放大（上限 1.9 防止夸张）。
  function fitView() {
    var wrap = document.getElementById('canvasWrap');
    if (!lastLayout) {
      wrap.style.height = '';
      view = { k: 1, tx: 0, ty: 0 };
      applyView();
      return;
    }
    var bb = lastLayout.bounds;
    // 用「卡片实际占用的矩形」贴合，而不是带留白的画布尺寸 —— 留白不参与缩放，节点就能真正铺满
    var cw = Math.max(bb ? bb.maxX - bb.minX : lastLayout.w, 1);
    var ch = Math.max(bb ? bb.maxY - bb.minY : lastLayout.h, 1);
    var w = Math.max(wrap.clientWidth, 200);
    var availH = Math.max(Math.min(window.innerHeight * 0.76, 940), 340);

    // 1) 两轴贴合：min(宽比, 高比)，0.995 留一线边框
    var k = Math.min(w / cw, availH / ch) * 0.995;
    k = clamp(k, 0.12, 1.9);

    // 2) 画布高度贴合实际内容（扁宽族谱不留下半屏空白），内容过高再压回可用高度
    var contentH = ch * k;
    var h = Math.min(availH, Math.max(320, contentH + 64));
    wrap.style.height = Math.round(h) + 'px';
    if (contentH > h - 12) {
      k = clamp((h - 12) / ch, 0.12, 1.9);
      contentH = ch * k;
    }

    view.k = k;
    view.tx = (w - cw * k) / 2 - (bb ? bb.minX * k : 0);
    view.ty = Math.max((h - contentH) / 2, 4) - (bb ? bb.minY * k : 0);
    applyView();
  }

  function centerOnPerson(id) {
    if (!lastLayout) return;
    var n = null;
    lastLayout.nodes.forEach(function (m) { if (m.id === id) n = m; });
    if (!n) return;
    var wrap = document.getElementById('canvasWrap');
    var w = wrap.clientWidth, h = wrap.clientHeight;
    view.tx = w / 2 - (n.x + CARD_W / 2) * view.k;
    view.ty = h / 2 - (n.y + CARD_H / 2) * view.k;
    applyView();
  }

  /* ================= 渲染：成员列表（按代折叠） ================= */
  var openGens = {};

  function renderMemberGroups() {
    var box = document.getElementById('memberGroups');
    var stat = document.getElementById('memberStat');
    if (!box) return;
    box.innerHTML = '';
    if (!persons.length) {
      box.innerHTML = '<div class="hint" style="padding:8px 2px">还没有成员。</div>';
      if (stat) stat.textContent = '';
      return;
    }

    var gen = computeGenerations();
    var q = (document.getElementById('memberSearch').value || '').trim();
    var rows = {}, matched = 0;
    persons.forEach(function (p) {
      var ok = !q || p.name.indexOf(q) >= 0
        || (p.note || '').indexOf(q) >= 0
        || (p.birth || '').indexOf(q) >= 0;
      if (!ok) return;
      matched++;
      var g = gen[p.id];
      (rows[g] || (rows[g] = [])).push(p);
    });

    if (stat) stat.textContent = '共 ' + persons.length + ' 人' + (q ? ' · 匹配 ' + matched + ' 人' : '');

    var gens = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
    if (!gens.length) {
      box.innerHTML = '<div class="hint" style="padding:10px 2px">没有匹配的成员。</div>';
      return;
    }

    gens.forEach(function (g) {
      var list = rows[g].slice().sort(function (a, b) { return idxOf(a.id) - idxOf(b.id); });
      var opened = q ? true : !!openGens[g];
      var wrap = document.createElement('div');
      wrap.className = 'gen-group' + (opened ? ' open' : '');
      wrap.setAttribute('data-gen', g);

      var head = document.createElement('button');
      head.className = 'gen-head';
      head.type = 'button';
      head.innerHTML = '<span class="gl"><span class="chev">▶</span><span class="gname">第 ' + (g + 1) + ' 代</span>'
        + '<span class="gcnt">' + list.length + ' 人' + (g === 0 ? ' · 最上' : '') + '</span></span>';
      wrap.appendChild(head);

      var body = document.createElement('div');
      body.className = 'gen-body';
      var tb = document.createElement('table');
      tb.innerHTML = '<thead><tr><th style="width:150px">姓名</th><th style="width:60px">性别</th>'
        + '<th>父母</th><th>配偶</th><th style="width:110px">操作</th></tr></thead>';
      var tbody = document.createElement('tbody');

      list.forEach(function (p) {
        var tr = document.createElement('tr');
        var parents = p.parents.map(function (id) { var x = getPerson(id); return x ? x.name : '?'; }).join('、') || '—';
        var parentsHtml = esc(parents);
        var steps = (p.stepParents || []).map(function (id) { var x = getPerson(id); return x ? x.name : '?'; });
        if (steps.length) parentsHtml += ' <span class="pill">继 ' + esc(steps.join('、')) + '</span>';
        var spouses = p.spouses.map(function (id) { var x = getPerson(id); return x ? x.name : '?'; }).join('、') || '—';
        var sexCls = p.sex === 'M' ? 'm' : 'f';
        tr.innerHTML =
          '<td><span class="nm" data-focus="' + p.id + '" title="在树中定位">' + esc(p.name) + '</span>'
          + (p.deceased ? '<span class="dy">†' + (p.death ? ' ' + esc(p.death) : '') + '</span>' : '') + '</td>'
          + '<td><span class="pill ' + sexCls + '">' + sexLabel(p.sex) + '</span></td>'
          + '<td>' + parentsHtml + '</td>'
          + '<td>' + esc(spouses) + '</td>'
          + '<td><button class="ghost mini" data-edit="' + p.id + '">编辑</button>'
          + '<button class="ghost mini" data-del="' + p.id + '">删除</button></td>';
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      body.appendChild(tb);
      wrap.appendChild(body);

      head.addEventListener('click', function () {
        openGens[g] = !wrap.classList.contains('open');
        wrap.classList.toggle('open');
      });

      box.appendChild(wrap);
    });
  }

  /* ================= 称谓 ================= */
  function neighbors(id, allowStep) {
    var p = getPerson(id), n = [];
    if (!p) return n;
    p.parents.forEach(function (pid) { if (getPerson(pid)) n.push([pid, 'up']); });
    if (allowStep) (p.stepParents || []).forEach(function (pid) { if (getPerson(pid)) n.push([pid, 'stepup']); });
    childrenOf(id).forEach(function (cid) { n.push([cid, 'down']); });
    p.spouses.forEach(function (sid) { if (getPerson(sid)) n.push([sid, 'spouse']); });
    // 同父母/同继父母的兄弟姐妹
    var sibs = {};
    allParentsOf(p).forEach(function (pid) {
      persons.forEach(function (q) {
        if (q.id === p.id) return;
        if (allParentsOf(q).indexOf(pid) >= 0) sibs[q.id] = 1;
      });
    });
    Object.keys(sibs).forEach(function (sid) { n.push([sid, 'sib']); });
    return n;
  }

  function relWord(from, to, kind) {
    var t = getPerson(to);
    if (!t) return '';
    if (kind === 'up') return t.sex === 'M' ? '爸爸' : '妈妈';
    if (kind === 'stepup') return t.sex === 'M' ? '继父' : '继母';
    if (kind === 'down') return t.sex === 'M' ? '儿子' : '女儿';
    if (kind === 'spouse') return t.sex === 'M' ? '丈夫' : '妻子';
    if (kind === 'sib') return t.sex === 'M' ? '兄弟' : '姐妹';
    return '';
  }

  function chainAB(A, B, allowStep) {
    if (A === B) return '';
    var q = [[A, []]], seen = {};
    seen[A] = true;
    while (q.length) {
      var cur = q.shift(), path = cur[1];
      var nbs = neighbors(cur[0], allowStep);
      for (var i = 0; i < nbs.length; i++) {
        var nb = nbs[i][0], kind = nbs[i][1];
        if (seen[nb]) continue;
        var w = relWord(cur[0], nb, kind);
        if (!w) continue;
        var np = path.concat([w]);
        if (nb === B) return np;
        seen[nb] = true;
        if (np.length < 12) q.push([nb, np]);
      }
    }
    return null;
  }

  function termAB(A, B) {
    if (A === B) return { term: '自己', chain: '本人' };
    var pa = getPerson(A), pb = getPerson(B);
    if (!pa || !pb) return null;

    // 直系继亲优先判定：B 是 A 的继父/继母，或 A 是 B 的继子女
    if ((pa.stepParents || []).indexOf(B) >= 0) {
      var t1 = pb.sex === 'M' ? '继父' : '继母';
      return { term: t1, chain: t1, step: true };
    }
    if ((pb.stepParents || []).indexOf(A) >= 0) {
      // A 是 B 的继父母 → 反过来说 B 是 A 的继子女，性别取 B 的
      var t2 = pb.sex === 'M' ? '继子' : '继女';
      return { term: t2, chain: t2, step: true };
    }

    var pure = chainAB(A, B, false);
    if (pure) {
      var sex = pa.sex === 'M' ? 1 : 0;
      try {
        var r = relationship({ text: pure.join('的'), sex: sex });
        if (Array.isArray(r) && r.length) return { term: r.join(' / '), chain: pure.join('→') };
      } catch (e) {}
      return { term: null, chain: pure.join('→') };
    }
    var mixed = chainAB(A, B, true);
    if (!mixed) return null;
    if (mixed.length === 1) return { term: mixed[0], chain: mixed[0], step: true };
    var hasStep = mixed.some(function (w) { return w === '继父' || w === '继母'; });
    if (!hasStep) {
      var sex2 = pa.sex === 'M' ? 1 : 0;
      try {
        var r2 = relationship({ text: mixed.join('的'), sex: sex2 });
        if (Array.isArray(r2) && r2.length) return { term: r2.join(' / '), chain: mixed.join('→') };
      } catch (e) {}
      return { term: null, chain: mixed.join('→') };
    }
    var text = mixed.join('的').replace(/继父/g, '爸爸').replace(/继母/g, '妈妈');
    var sex3 = pa.sex === 'M' ? 1 : 0;
    try {
      var r3 = relationship({ text: text, sex: sex3 });
      if (Array.isArray(r3) && r3.length) {
        return { term: r3.join(' / ') + '（继亲）', chain: mixed.join('→'), step: true };
      }
    } catch (e) {}
    return { term: null, chain: mixed.join('→'), step: true };
  }

  function doRelation() {
    var a = pickerRelA ? pickerRelA.getSelected()[0] : null;
    var b = pickerRelB ? pickerRelB.getSelected()[0] : null;
    var box = document.getElementById('relResult');
    if (!a || !b) { box.innerHTML = '<div class="hint">请先选两个人。</div>'; return; }
    var pa = getPerson(a), pb = getPerson(b);
    if (!pa || !pb) { box.innerHTML = '<div class="hint">成员不存在。</div>'; return; }
    var ab = termAB(a, b), ba = termAB(b, a);
    var html = '<div class="rel-line">' + esc(pa.name) + ' 称 ' + esc(pb.name) + '：';
    if (ab && ab.term) html += '<span class="rel-term">' + esc(ab.term) + '</span>';
    else if (ab) html += '<span class="hint">（无法确定称谓，关系链：' + esc(ab.chain) + '）</span>';
    else html += '<span class="hint">（家族树里没有连通，无法推算）</span>';
    html += '</div>';
    html += '<div class="rel-line">' + esc(pb.name) + ' 称 ' + esc(pa.name) + '：';
    if (ba && ba.term) html += '<span class="rel-term">' + esc(ba.term) + '</span>';
    else if (ba) html += '<span class="hint">（无法确定称谓，关系链：' + esc(ba.chain) + '）</span>';
    else html += '<span class="hint">（家族树里没有连通，无法推算）</span>';
    html += '</div>';
    if (ab && ab.chain) html += '<div class="rel-chain">' + esc(pa.name) + ' 的关系链：' + esc(ab.chain) + '</div>';
    box.innerHTML = html;
  }

  function setRelOptions() {
    if (!pickerRelA) return;
    var gen = computeGenerations();
    function toOpt(p) {
      return { id: p.id, name: p.name, sex: p.sex, deceased: p.deceased, sub: '第' + ((gen[p.id] || 0) + 1) + '代' };
    }
    var list = persons.slice().sort(function (a, b) { return idxOf(a.id) - idxOf(b.id); }).map(toOpt);
    pickerRelA.setOptions(list);
    pickerRelB.setOptions(list);
  }

  /* ================= 弹窗表单 ================= */
  var modalMode = 'add';      // add | edit | addChild | addSpouse | addParent | addStepParent
  var modalTarget = null;
  var modalRole = 'M';
  var editingId = null;
  var formSpouseOverride = null;
  var formStepOverride = null;
  var pickerSF = null, pickerSM = null, pickerSP = null;
  var pickerRelA = null, pickerRelB = null;
  function initPickers() {
    if (pickerSF) return;
    pickerSF = makePicker(document.getElementById('f-stepfather'), { multi: true, placeholder: '搜索男性…' });
    pickerSM = makePicker(document.getElementById('f-stepmother'), { multi: true, placeholder: '搜索女性…' });
    pickerSP = makePicker(document.getElementById('f-spouses'), { multi: true, placeholder: '搜索成员（可多选）…' });
    pickerRelA = makePicker(document.getElementById('relA'), { multi: false, placeholder: '搜索人物 A…' });
    pickerRelB = makePicker(document.getElementById('relB'), { multi: false, placeholder: '搜索人物 B…' });
  }

  function resetFormFields() {
    document.getElementById('f-name').value = '';
    document.querySelector('input[name="f-sex"][value="M"]').checked = true;
    document.getElementById('f-birth').value = '';
    document.getElementById('f-death').value = '';
    document.getElementById('f-deceased').checked = false;
    document.getElementById('f-death-wrap').classList.add('hidden');
    document.getElementById('f-note').value = '';
    formSpouseOverride = null;
    formStepOverride = null;
    if (pickerSF) { pickerSF.clear(); pickerSM.clear(); pickerSP.clear(); }
  }

  function candidates(excludeIds, sex) {
    return persons.filter(function (p) {
      if (excludeIds.indexOf(p.id) >= 0) return false;
      if (sex && p.sex !== sex) return false;
      return true;
    });
  }

  function buildSelect(sel, list, placeholder, selected) {
    sel.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = placeholder;
    sel.appendChild(o0);
    list.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.deceased ? ' †' : '') + '（' + sexLabel(p.sex) + '）';
      sel.appendChild(o);
    });
    sel.value = selected && getPerson(selected) ? selected : '';
  }

  /* ================= 可搜索多选选择器 ================= */
  function makePicker(container, opts) {
    container.innerHTML = '';
    container.className = (container.className || '').replace(/\bpick-box\b/, '').trim() + ' picker-host';
    var wrap = document.createElement('div'); wrap.className = 'picker';
    var chips = document.createElement('div'); chips.className = 'picker-chips';
    var input = document.createElement('input'); input.type = 'text'; input.className = 'picker-input';
    input.placeholder = opts.placeholder || '搜索…';
    var drop = document.createElement('div'); drop.className = 'picker-drop hidden';
    wrap.appendChild(chips); wrap.appendChild(input); wrap.appendChild(drop);
    container.appendChild(wrap);

    var selected = [];
    var options = [];

    function renderChips() {
      chips.innerHTML = '';
      selected.forEach(function (id) {
        var p = getPerson(id); if (!p) return;
        var chip = document.createElement('span');
        chip.className = 'picker-chip ' + (p.sex === 'M' ? 'm' : 'f');
        chip.appendChild(document.createTextNode(p.name + (p.deceased ? ' †' : '')));
        var x = document.createElement('span'); x.className = 'picker-x'; x.textContent = '✕';
        x.setAttribute('data-id', id);
        chip.appendChild(x);
        chips.appendChild(chip);
      });
    }
    function renderDrop() {
      drop.innerHTML = '';
      var q = input.value.trim().toLowerCase();
      var list = options.filter(function (o) {
        if (selected.indexOf(o.id) >= 0) return false;
        if (!q) return true;
        return (o.name || '').toLowerCase().indexOf(q) >= 0 || (o.sub || '').toLowerCase().indexOf(q) >= 0;
      });
      if (!list.length) { drop.innerHTML = '<div class="picker-empty">无匹配</div>'; drop.classList.remove('hidden'); return; }
      list.slice(0, 40).forEach(function (o) {
        var it = document.createElement('div'); it.className = 'picker-opt'; it.setAttribute('data-id', o.id);
        var nm = document.createElement('span'); nm.className = 'picker-opt-name';
        nm.textContent = o.name + (o.deceased ? ' †' : '');
        var sb = document.createElement('span'); sb.className = 'picker-opt-sub';
        sb.textContent = (o.sex === 'M' ? '男' : '女') + (o.sub ? ' · ' + o.sub : '');
        it.appendChild(nm); it.appendChild(sb);
        drop.appendChild(it);
      });
      drop.classList.remove('hidden');
    }
    input.addEventListener('focus', renderDrop);
    input.addEventListener('input', renderDrop);
    input.addEventListener('blur', function () { setTimeout(function () { drop.classList.add('hidden'); }, 150); });
    drop.addEventListener('mousedown', function (e) {
      var opt = e.target.closest ? e.target.closest('.picker-opt') : null;
      if (!opt) return;
      var id = opt.getAttribute('data-id');
      if (opts.multi) { if (selected.indexOf(id) < 0) selected.push(id); }
      else { selected = [id]; }
      input.value = ''; renderChips(); renderDrop(); input.focus();
    });
    chips.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('picker-x')) {
        var id = e.target.getAttribute('data-id');
        selected = selected.filter(function (x) { return x !== id; });
        renderChips(); renderDrop();
      }
    });

    return {
      setOptions: function (list) {
        options = (list || []).slice();
        selected = selected.filter(function (id) { return options.some(function (o) { return o.id === id; }); });
        renderChips();
      },
      getSelected: function () { return selected.slice(); },
      setSelected: function (ids) { selected = (ids || []).slice(); renderChips(); },
      clear: function () { selected = []; renderChips(); }
    };
  }

  function refreshFormOptions() {
    var selfId = editingId || '';
    var exclude = selfId ? [selfId] : [];
    // 编辑时排除自己的后代（防环）
    if (selfId) {
      persons.forEach(function (p) {
        if (isDescendantOf(p.id, selfId)) exclude.push(p.id);
      });
    }
    var curFather = document.getElementById('f-father').value;
    var curMother = document.getElementById('f-mother').value;

    buildSelect(document.getElementById('f-father'), candidates(exclude, 'M'), '（无 / 未知）', curFather);
    buildSelect(document.getElementById('f-mother'), candidates(exclude, 'F'), '（无 / 未知）', curMother);

    var fatherId = document.getElementById('f-father').value;
    var motherId = document.getElementById('f-mother').value;
    var exStep = exclude.concat([fatherId, motherId]).filter(Boolean);
    var gmap = computeGenerations();
    function toOpt(p) {
      return { id: p.id, name: p.name, sex: p.sex, deceased: p.deceased, sub: '第' + ((gmap[p.id] || 0) + 1) + '代' };
    }
    pickerSF.setOptions(candidates(exStep, 'M').map(toOpt));
    pickerSM.setOptions(candidates(exStep, 'F').map(toOpt));
    pickerSP.setOptions(candidates(exclude, null).map(toOpt));

    if (formSpouseOverride) { pickerSP.setSelected(formSpouseOverride); formSpouseOverride = null; }
  }

  function openModal() {
    document.getElementById('modal').style.display = 'block';
  }
  function closeModal() {
    document.getElementById('modal').style.display = 'none';
  }

  function showAddRoot() {
    modalMode = 'add'; modalTarget = null; modalRole = 'M'; editingId = null;
    resetFormFields();
    document.getElementById('f-parents-row').classList.remove('hidden');
    document.getElementById('parent-note').classList.add('hidden');
    document.getElementById('modal-title').textContent = '添加成员';
    document.getElementById('btn-save').textContent = '添加';
    refreshFormOptions();
    openModal();
    document.getElementById('f-name').focus();
  }

  function showAddChild(id) {
    var t = getPerson(id); if (!t) return;
    modalMode = 'addChild'; modalTarget = id; modalRole = 'M'; editingId = null;
    resetFormFields();
    document.getElementById('f-parents-row').classList.remove('hidden');
    document.getElementById('parent-note').classList.add('hidden');
    document.getElementById('modal-title').textContent = '为「' + t.name + '」添加子女';
    document.getElementById('btn-save').textContent = '添加';
    refreshFormOptions();
    // 选项就绪后再预填
    if (t.sex === 'M') document.getElementById('f-father').value = id;
    else document.getElementById('f-mother').value = id;
    var co = t.spouses.filter(function (s) { return getPerson(s); })[0];
    if (co) {
      var q = getPerson(co);
      if (t.sex === 'M' && q.sex === 'F') document.getElementById('f-mother').value = co;
      else if (t.sex === 'F' && q.sex === 'M') document.getElementById('f-father').value = co;
    }
    document.querySelector('input[name="f-sex"][value="M"]').checked = true;
    openModal();
    document.getElementById('f-name').focus();
  }

  function showAddSpouse(id) {
    var t = getPerson(id); if (!t) return;
    modalMode = 'addSpouse'; modalTarget = id; editingId = null;
    modalRole = t.sex === 'M' ? 'F' : 'M';
    resetFormFields();
    document.getElementById('f-parents-row').classList.remove('hidden');
    document.getElementById('parent-note').classList.add('hidden');
    document.getElementById('modal-title').textContent = '为「' + t.name + '」添加配偶';
    document.getElementById('btn-save').textContent = '添加';
    formSpouseOverride = [id];
    refreshFormOptions();
    formSpouseOverride = null;
    document.querySelector('input[name="f-sex"][value="' + modalRole + '"]').checked = true;
    openModal();
    document.getElementById('f-name').focus();
  }

  function showAddParent(id, role) {
    var t = getPerson(id); if (!t) return;
    modalMode = 'addParent'; modalTarget = id; modalRole = role; editingId = null;
    resetFormFields();
    document.getElementById('f-parents-row').classList.add('hidden');
    var note = document.getElementById('parent-note');
    note.classList.remove('hidden');
    note.textContent = '新成员将作为「' + t.name + '」的' + (role === 'M' ? '父亲' : '母亲') + '。'
      + '若在「配偶」里勾选其伴侣，伴侣会一并作为另一位家长。';
    document.getElementById('modal-title').textContent = '为「' + t.name + '」添加' + (role === 'M' ? '父亲' : '母亲');
    document.getElementById('btn-save').textContent = '添加';
    refreshFormOptions();
    document.querySelector('input[name="f-sex"][value="' + role + '"]').checked = true;
    openModal();
    document.getElementById('f-name').focus();
  }

  function showAddStepParent(id, role) {
    var t = getPerson(id); if (!t) return;
    modalMode = 'addStepParent'; modalTarget = id; modalRole = role; editingId = null;
    resetFormFields();
    document.getElementById('f-parents-row').classList.add('hidden');
    var note = document.getElementById('parent-note');
    note.classList.remove('hidden');
    note.textContent = '新成员将作为「' + t.name + '」的' + (role === 'M' ? '继父' : '继母')
      + '（无血缘关系，树上用虚线连接）。若其与「' + t.name + '」的亲生'
      + (role === 'M' ? '母亲' : '父亲') + '是夫妻，可在「配偶」里一并勾选。';
    document.getElementById('modal-title').textContent = '为「' + t.name + '」添加' + (role === 'M' ? '继父' : '继母');
    document.getElementById('btn-save').textContent = '添加';
    refreshFormOptions();
    document.querySelector('input[name="f-sex"][value="' + role + '"]').checked = true;
    openModal();
    document.getElementById('f-name').focus();
  }

  function showEdit(id) {
    var p = getPerson(id); if (!p) return;
    modalMode = 'edit'; modalTarget = id; editingId = id;
    resetFormFields();
    document.getElementById('f-name').value = p.name;
    document.querySelector('input[name="f-sex"][value="' + p.sex + '"]').checked = true;
    document.getElementById('f-birth').value = p.birth || '';
    document.getElementById('f-deceased').checked = !!p.deceased;
    document.getElementById('f-death').value = p.death || '';
    document.getElementById('f-death-wrap').classList.toggle('hidden', !p.deceased);
    document.getElementById('f-note').value = p.note || '';
    document.getElementById('f-parents-row').classList.remove('hidden');
    document.getElementById('parent-note').classList.add('hidden');
    document.getElementById('modal-title').textContent = '编辑「' + p.name + '」';
    document.getElementById('btn-save').textContent = '保存修改';

    formSpouseOverride = p.spouses.slice();
    refreshFormOptions();
    // 回填亲生父母
    var dad = p.parents.filter(function (pid) { var x = getPerson(pid); return x && x.sex === 'M'; })[0] || '';
    var mom = p.parents.filter(function (pid) { var x = getPerson(pid); return x && x.sex === 'F'; })[0] || '';
    document.getElementById('f-father').value = dad;
    document.getElementById('f-mother').value = mom;
    formSpouseOverride = null;
    // 继父母 + 配偶 回填（搜索选择器）
    pickerSF.setSelected((p.stepParents || []).filter(function (id) { var x = getPerson(id); return x && x.sex === 'M'; }));
    pickerSM.setSelected((p.stepParents || []).filter(function (id) { var x = getPerson(id); return x && x.sex === 'F'; }));
    pickerSP.setSelected(p.spouses.slice());

    openModal();
  }

  function collectForm() {
    var name = document.getElementById('f-name').value.trim();
    if (!name) { alert('请填写姓名'); return null; }
    var sex = document.querySelector('input[name="f-sex"]:checked').value;
    var parents = [];
    var f = document.getElementById('f-father').value;
    var m = document.getElementById('f-mother').value;
    if (f) parents.push(f);
    if (m) parents.push(m);
    var steps = pickerSF.getSelected().concat(pickerSM.getSelected())
      .filter(function (id) { return parents.indexOf(id) < 0; });
    var spouses = pickerSP.getSelected();
    return {
      name: name, sex: sex, parents: parents, stepParents: steps, spouses: spouses,
      birth: document.getElementById('f-birth').value.trim(),
      death: document.getElementById('f-death').value.trim(),
      deceased: document.getElementById('f-deceased').checked,
      note: document.getElementById('f-note').value.trim()
    };
  }

  function validate(form, selfId) {
    var selfGen = selfId ? true : false;
    var cands = form.parents.concat(form.stepParents);
    for (var i = 0; i < cands.length; i++) {
      if (selfId && cands[i] === selfId) { alert('不能把自己设为父母'); return false; }
    }
    if (form.parents.length === 2) {
      var a = getPerson(form.parents[0]), b = getPerson(form.parents[1]);
      if (a && b && a.sex === b.sex) { alert('父亲和母亲不能是同一性别，请把其中一位改为继亲'); return false; }
    }
    if (selfId) {
      for (var k = 0; k < cands.length; k++) {
        if (isDescendantOf(cands[k], selfId)) {
          alert('不能把本人的后代设为父母或继父母（会形成环）');
          return false;
        }
      }
    }
    return true;
  }

  function saveMember() {
    var form = collectForm();
    if (!form) return;

    if (modalMode === 'edit') {
      if (!validate(form, editingId)) return;
      var p = getPerson(editingId);
      if (!p) return;
      p.name = form.name; p.sex = form.sex;
      p.parents = form.parents; p.stepParents = form.stepParents;
      p.birth = form.birth; p.death = form.death;
      p.deceased = form.deceased || !!form.death;
      p.note = form.note;
      // 配偶双向同步
      var old = p.spouses.slice();
      old.forEach(function (sid) {
        var q = getPerson(sid);
        if (q && form.spouses.indexOf(sid) < 0) q.spouses = q.spouses.filter(function (x) { return x !== p.id; });
      });
      form.spouses.forEach(function (sid) {
        var q = getPerson(sid);
        if (q && q.spouses.indexOf(p.id) < 0) q.spouses.push(p.id);
      });
      p.spouses = form.spouses.slice();
      closeModal();
      afterChange('已保存修改');
      return;
    }

    // 新增
    if (!validate(form, null)) return;
    var np = {
      id: newId(), name: form.name, sex: form.sex,
      parents: form.parents, stepParents: form.stepParents, spouses: form.spouses,
      birth: form.birth, death: form.death,
      deceased: form.deceased || !!form.death, note: form.note
    };
    persons.push(np);

    // 场景补充关系
    if (modalMode === 'addChild' && modalTarget) {
      var t = getPerson(modalTarget);
      if (t && np.parents.indexOf(t.id) < 0) np.parents.push(t.id);
    }
    if (modalMode === 'addParent' && modalTarget) {
      var c1 = getPerson(modalTarget);
      if (c1 && c1.parents.indexOf(np.id) < 0) c1.parents.push(np.id);
    }
    if (modalMode === 'addStepParent' && modalTarget) {
      var c2 = getPerson(modalTarget);
      if (c2) {
        if (c2.stepParents.indexOf(np.id) < 0) c2.stepParents.push(np.id);
        // 若生父/生母在，且继父母为异性且未配偶，自动结为配偶（常见情形）
        var bio = c2.parents.map(function (pid) { return getPerson(pid); })
          .filter(function (x) { return x && x.sex !== np.sex; })[0];
        if (bio && bio.spouses.indexOf(np.id) < 0 && !bio.deceased) {
          bio.spouses.push(np.id);
          if (np.spouses.indexOf(bio.id) < 0) np.spouses.push(bio.id);
        }
      }
    }
    // 配偶双向
    np.spouses.forEach(function (sid) {
      var q = getPerson(sid);
      if (q && q.spouses.indexOf(np.id) < 0) q.spouses.push(np.id);
    });

    closeModal();
    afterChange('已添加「' + np.name + '」');
    // 自动定位到新人
    setTimeout(function () { centerOnPerson(np.id); }, 60);
  }

  function deleteMember(id) {
    var p = getPerson(id);
    if (!p) return;
    if (!confirm('确定删除「' + p.name + '」？其关系也会一并解除。')) return;
    persons = persons.filter(function (x) { return x.id !== id; });
    persons.forEach(function (x) {
      x.parents = x.parents.filter(function (i) { return i !== id; });
      x.stepParents = (x.stepParents || []).filter(function (i) { return i !== id; });
      x.spouses = x.spouses.filter(function (i) { return i !== id; });
    });
    afterChange('已删除');
  }

  function afterChange(msg) {
    normalizeAll();
    save();
    netLayoutCache = null;   // 数据变化，网图缓存作废
    renderAll();
    if (msg) toast(msg);
  }

  /* ================= 导出图片（PNG / SVG） ================= */
  function dateStamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // 克隆当前 SVG（含背景带/连线/卡片/世代标签），复位变换以导出完整树
  function snapshotSVG() {
    var svg = document.getElementById('treeSvg');
    var w = lastLayout ? lastLayout.w : 800, h = lastLayout ? lastLayout.h : 600;
    var clone = svg.cloneNode(true);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    clone.setAttribute('font-family', '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif');
    clone.removeAttribute('style');
    var vp = clone.querySelector('#viewport');
    if (vp) vp.removeAttribute('transform');
    var bg = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#ffffff"></rect>';
    clone.insertAdjacentHTML('afterbegin', bg);
    return { svg: clone, w: w, h: h };
  }
  function exportSVG() {
    if (!lastLayout) { toast('没有可导出的内容'); return; }
    var snap = snapshotSVG();
    var xml = new XMLSerializer().serializeToString(snap.svg);
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'family-tree-' + dateStamp() + '.svg';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出 SVG');
  }
  function exportPNG() {
    if (!lastLayout) { toast('没有可导出的内容'); return; }
    var snap = snapshotSVG();
    var xml = new XMLSerializer().serializeToString(snap.svg);
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    var img = new Image();
    img.onload = function () {
      var scale = 2;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(snap.w * scale);
      canvas.height = Math.round(snap.h * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function (blob) {
        if (!blob) { alert('导出 PNG 失败'); return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'family-tree-' + dateStamp() + '.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast('已导出 PNG');
      });
    };
    img.onerror = function () { alert('导出失败：SVG 无法渲染（可能是浏览器限制）'); };
    img.src = url;
  }

  function renderAll(opts) {
    renderTree();
    renderMemberGroups();
    setRelOptions();
    if (opts && opts.fit) setTimeout(fitView, 30);
  }

  /* ================= 节点菜单 ================= */
  function hideMenu() {
    var m = document.getElementById('nodeMenu');
    if (m) m.style.display = 'none';
  }

  function showNodeMenu(id, cx, cy) {
    var p = getPerson(id);
    if (!p) return;
    var menu = document.getElementById('nodeMenu');
    var items = [
      ['child', '＋ 添加子女（下一辈）'],
      ['spouse', '＋ 添加配偶'],
      ['sep'],
      ['father', '＋ 添加父亲（上一辈）'],
      ['mother', '＋ 添加母亲（上一辈）'],
      ['stepfather', '＋ 添加继父'],
      ['stepmother', '＋ 添加继母'],
      ['sep'],
      ['center', '◎ 移到画面中央'],
      ['edit', '✎ 编辑资料'],
      ['del', '✕ 删除成员']
    ];
    var html = '<div class="nm-title">' + esc(p.name) + '（' + sexLabel(p.sex) + (p.deceased ? ' · 已故' : '') + '）</div>';
    items.forEach(function (it) {
      if (it[0] === 'sep') { html += '<div class="sep"></div>'; return; }
      var danger = it[0] === 'del' ? ' class="danger"' : '';
      html += '<button data-act="' + it[0] + '" data-id="' + id + '"' + danger + '>' + it[1] + '</button>';
    });
    menu.innerHTML = html;
    menu.style.display = 'block';
    menu.style.left = '0px'; menu.style.top = '0px';
    var r = menu.getBoundingClientRect();
    var left = Math.min(cx + 6, window.innerWidth - r.width - 8);
    var top = Math.min(cy + 6, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(6, left) + 'px';
    menu.style.top = Math.max(6, top) + 'px';
  }

  /* ================= 示例 ================= */
  function loadSample() {
    if (persons.length && !confirm('已有数据，载入示例会覆盖当前数据。继续？')) return;
    persons = [
      { id: 'gf', name: '爷爷', sex: 'M', parents: [], spouses: ['gm'], birth: '1932', death: '2008', deceased: true, note: '' },
      { id: 'gm', name: '奶奶', sex: 'F', parents: [], spouses: ['gf'], birth: '1936', death: '2015', deceased: true, note: '' },
      { id: 'f', name: '爸爸', sex: 'M', parents: ['gf', 'gm'], spouses: ['m', 'sm'], birth: '1960', note: '' },
      { id: 'm', name: '妈妈', sex: 'F', parents: [], spouses: ['f'], birth: '1963', note: '' },
      { id: 'sm', name: '继母', sex: 'F', parents: [], spouses: ['f'], birth: '1972', note: '爸爸的第二任妻子（示例）' },
      { id: 'wf', name: '岳父', sex: 'M', parents: [], spouses: ['wm'], birth: '1938', note: '' },
      { id: 'wm', name: '岳母', sex: 'F', parents: [], spouses: ['wf'], birth: '1941', note: '' },
      { id: 'un', name: '叔叔', sex: 'M', parents: ['gf', 'gm'], spouses: ['au'], birth: '1965', note: '' },
      { id: 'au', name: '婶婶', sex: 'F', parents: [], spouses: ['un'], birth: '1967', note: '' },
      { id: 'me', name: '我', sex: 'M', parents: ['f', 'm'], stepParents: ['sm'], spouses: ['wife'], birth: '1988', note: '' },
      { id: 'wife', name: '妻子', sex: 'F', parents: ['wf', 'wm'], spouses: ['me'], birth: '1990', note: '' },
      { id: 'cou', name: '堂弟', sex: 'M', parents: ['un', 'au'], spouses: [], birth: '1992', note: '' }
    ];
    mainId = 'me';
    normalizeAll();
    afterChange('示例已载入');
    setTimeout(fitView, 40);
  }

  /* ================= 初始化与事件 ================= */
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.classList.remove('show'); }, 1600);
  }

  function closestNodeId(el) {
    var cur = el;
    while (cur && cur !== document.getElementById('treeSvg')) {
      if (cur.getAttribute && cur.getAttribute('data-nodeid')) return cur.getAttribute('data-nodeid');
      if (cur.classList && cur.classList.contains('tnode')) return cur.getAttribute('data-nodeid');
      cur = cur.parentNode;
    }
    return null;
  }

  function bind() {
    initPickers();
    var canvas = document.getElementById('canvasWrap');
    var svg = document.getElementById('treeSvg');
    var drag = null;

    // 滚轮缩放
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    // 拖拽：命中卡片则拖动该节点（网图自由 / 树形同代水平），否则平移画布
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var id = closestNodeId(e.target);
      if (id) {
        drag = {
          mode: 'node', id: id, x: e.clientX, y: e.clientY, moved: 0,
          st: { id: id, x0: e.clientX, y0: e.clientY, startWant: undefined, startNet: null }
        };
      } else {
        drag = { mode: 'pan', x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: 0 };
      }
    });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      if (drag.moved <= 4) return;
      canvas.classList.add('dragging');
      if (drag.mode === 'node') {
        queueNodeDrag(drag.st, e.clientX, e.clientY);   // 绝对目标 + rAF 合帧
      } else {
        view.tx = drag.tx + dx;
        view.ty = drag.ty + dy;
        applyView();
      }
    });
    window.addEventListener('mouseup', function () {
      if (!drag) return;
      var wasDrag = drag.moved > 4;
      var wasNode = drag.mode === 'node';
      if (wasNode && wasDrag) {
        flushNodeDrag();                     // 补上最后一帧，落点严格等于指针位置
        if (drag.st) drag.st.done = true;
        endTreeDrag();
        saveManualLayout();
      } else if (dragRaf) {
        cancelAnimationFrame(dragRaf); dragRaf = 0;
      }
      drag = null;
      canvas.classList.remove('dragging');
      if (wasDrag) {
        suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
      }
    });

    // 节点点击
    var suppressClick = false;
    var touchMoved = false;
    svg.addEventListener('click', function (e) {
      if (suppressClick || touchMoved) { suppressClick = false; touchMoved = false; return; }
      var id = closestNodeId(e.target);
      if (id) { e.stopPropagation(); showNodeMenu(id, e.clientX, e.clientY); return; }
      hideMenu();
    });

    // 触摸：单指平移/拖节点、双指捏合缩放（移动端）
    var touchState = null;
    canvas.addEventListener('touchstart', function (e) {
      touchMoved = false;
      if (e.touches.length === 1) {
        var t = e.touches[0];
        var nid = closestNodeId(t.target);
        if (nid) {
          touchState = {
            mode: 'node', id: nid, x: t.clientX, y: t.clientY,
            st: { id: nid, x0: t.clientX, y0: t.clientY, startWant: undefined, startNet: null }
          };
        } else {
          touchState = { mode: 'pan', x: t.clientX, y: t.clientY, tx: view.tx, ty: view.ty };
        }
      } else if (e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        touchState = {
          mode: 'pinch',
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2
        };
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      if (!touchState) return;
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      if (touchState.mode === 'node' && e.touches.length === 1) {
        var t = e.touches[0];
        queueNodeDrag(touchState.st, t.clientX, t.clientY);
        touchMoved = true;
        return;
      }
      if (touchState.mode === 'pan' && e.touches.length === 1) {
        var t2 = e.touches[0];
        var ddx = t2.clientX - touchState.x, ddy = t2.clientY - touchState.y;
        if (Math.abs(ddx) + Math.abs(ddy) > 6) touchMoved = true;
        view.tx = touchState.tx + ddx;
        view.ty = touchState.ty + ddy;
        applyView();
      } else if (e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        var dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        var cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
        var factor = dist / (touchState.dist || dist);
        var k2 = clamp(view.k * factor, 0.18, 3);
        var r2 = k2 / view.k;
        view.tx = cx - (cx - view.tx) * r2;
        view.ty = cy - (cy - view.ty) * r2;
        view.k = k2;
        touchState.dist = dist;
        applyView();
      }
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      if (e.touches.length === 0) {
        if (touchState && touchState.mode === 'node') {
          flushNodeDrag();
          if (touchState.st) touchState.st.done = true;
          endTreeDrag();
          saveManualLayout();
        }
        touchState = null;
      } else if (e.touches.length === 1) {
        var t = e.touches[0];
        touchState = { mode: 'pan', x: t.clientX, y: t.clientY, tx: view.tx, ty: view.ty };
      }
    });

    // 菜单操作
    document.getElementById('nodeMenu').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
      hideMenu();
      if (act === 'child') showAddChild(id);
      else if (act === 'spouse') showAddSpouse(id);
      else if (act === 'father') showAddParent(id, 'M');
      else if (act === 'mother') showAddParent(id, 'F');
      else if (act === 'stepfather') showAddStepParent(id, 'M');
      else if (act === 'stepmother') showAddStepParent(id, 'F');
      else if (act === 'center') centerOnPerson(id);
      else if (act === 'edit') showEdit(id);
      else if (act === 'del') deleteMember(id);
    });

    document.addEventListener('mousedown', function (e) {
      var menu = document.getElementById('nodeMenu');
      if (menu.style.display !== 'none' && !menu.contains(e.target)) hideMenu();
    });

    // 缩放按钮
    document.querySelector('.zoombar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var a = b.getAttribute('data-zoom');
      var wrap = document.getElementById('canvasWrap');
      if (a === 'in') zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.2);
      else if (a === 'out') zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.2);
      else if (a === 'fit') fitView();
      else if (a === 'reset') { view.k = 1; view.tx = 0; view.ty = 0; applyView(); }
    });

    // 成员列表
    var list = document.getElementById('memberGroups');
    list.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.edit) return showEdit(t.dataset.edit);
      if (t.dataset && t.dataset.del) return deleteMember(t.dataset.del);
      if (t.dataset && t.dataset.focus) {
        var g = t.closest('.gen-group');
        if (g) { openGens[Number(g.getAttribute('data-gen'))] = true; }
        centerOnPerson(t.dataset.focus);
        return;
      }
    });
    document.getElementById('memberSearch').addEventListener('input', function () {
      renderMemberGroups();
    });
    document.getElementById('btn-expand-all').addEventListener('click', function () {
      document.querySelectorAll('#memberGroups .gen-group').forEach(function (g) {
        g.classList.add('open');
        openGens[Number(g.getAttribute('data-gen'))] = true;
      });
    });
    document.getElementById('btn-collapse-all').addEventListener('click', function () {
      document.querySelectorAll('#memberGroups .gen-group').forEach(function (g) {
        g.classList.remove('open');
        openGens[Number(g.getAttribute('data-gen'))] = false;
      });
    });

    // 弹窗
    document.getElementById('btn-save').addEventListener('click', saveMember);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-x').addEventListener('click', closeModal);
    document.getElementById('modal-mask').addEventListener('click', closeModal);
    document.getElementById('f-deceased').addEventListener('change', function () {
      document.getElementById('f-death-wrap').classList.toggle('hidden', !this.checked);
    });

    document.getElementById('btn-add-root').addEventListener('click', showAddRoot);
    document.getElementById('btn-relayout').addEventListener('click', function () {
      netPos = {}; treeOffset = {}; netLayoutCache = null; treeDrag = null;
      saveManualLayout();
      renderAll({ fit: true });
      toast('已重新布局（清除手动调整）');
    });
    var tidyBtn = document.getElementById('btn-tidy');
    if (tidyBtn) tidyBtn.addEventListener('click', tidyTree);
    var vt = document.getElementById('viewToggle');
    if (vt) vt.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-view]') : null;
      if (!b) return;
      var v = b.getAttribute('data-view');
      if (v === viewMode) return;
      viewMode = v;
      document.querySelectorAll('#viewToggle button').forEach(function (x) {
        x.classList.toggle('active', x.getAttribute('data-view') === v);
      });
      renderAll({ fit: true });
    });
    document.getElementById('btn-rel').addEventListener('click', doRelation);

    // 数据
    document.getElementById('btn-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(persons, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      var d = new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      a.href = URL.createObjectURL(blob);
      a.download = 'family-tree-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('已导出');
    });
    document.getElementById('btn-export-png').addEventListener('click', exportPNG);
    document.getElementById('btn-export-svg').addEventListener('click', exportSVG);
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('file-import').click();
    });
    document.getElementById('file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var data = JSON.parse(rd.result);
          var arr = Array.isArray(data) ? data : (data && Array.isArray(data.persons) ? data.persons : null);
          if (!arr) throw new Error('格式错误');
          if (!confirm('导入会覆盖当前数据（当前 ' + persons.length + ' 人 → 导入 ' + arr.length + ' 人）。继续？')) return;
          persons = arr;
          normalizeAll();
          save();
          renderAll({ fit: true });
          toast('已导入 ' + persons.length + ' 人');
        } catch (err) {
          alert('导入失败：' + err.message);
        }
      };
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    });
    document.getElementById('btn-sample').addEventListener('click', loadSample);
    document.getElementById('btn-clear').addEventListener('click', function () {
      if (!persons.length) return;
      if (!confirm('确定清空全部 ' + persons.length + ' 位成员？此操作不可撤销，建议先导出备份。')) return;
      persons = [];
      afterChange('已清空');
    });

    // 视图尺寸变化后重排版
    window.addEventListener('resize', function () {
      clearTimeout(bind._rt);
      bind._rt = setTimeout(function () { if (lastLayout) fitView(); }, 160);
    });

    // 诊断角标
    document.getElementById('buildBadge').addEventListener('click', function () {
      var info = {
        build: this.getAttribute('data-build') || 'unknown',
        members: persons.length,
        generations: (function () { try { return computeGenerations(); } catch (e) { return 'ERR'; } })(),
        nodes: document.querySelectorAll('#treeSvg .tnode').length,
        layoutW: lastLayout ? Math.round(lastLayout.w) : 0,
        layoutH: lastLayout ? Math.round(lastLayout.h) : 0,
        zoom: view.k,
        lastError: window.__lastError || null
      };
      var txt = JSON.stringify(info, null, 1);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('诊断信息已复制'); }, function () { alert(txt); });
      } else { alert(txt); }
    });
  }

  function init() {
    window.__lastError = null;
    window.addEventListener('error', function (e) {
      window.__lastError = (e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || 0);
      var b = document.getElementById('buildBadge');
      if (b) { b.textContent = 'JS 错误 · 点此复制'; b.style.color = '#d33'; b.style.borderColor = '#d33'; }
    });
    load();
    loadManualLayout();
    bind();
    renderAll({ fit: true });
    setTimeout(fitView, 80);
  }

  // 暴露少量内部供测试
  window.__ft = {
    getPersons: function () { return persons; },
    computeGenerations: computeGenerations,
    computeLayout: computeLayout,
    computeNetLayout: computeNetLayout,
    setViewMode: function (v) { viewMode = v; },
    getViewMode: function () { return viewMode; },
    termAB: termAB,
    fitView: fitView,
    getView: function () { return view; },
    tidyTree: tidyTree,
    getTreeRailX: function () { return treeRailX; },
    getRenderCount: function () { return renderCount; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
