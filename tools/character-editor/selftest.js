/*
 * selftest.js —— spine-core 纯函数自检（契约 A9 / C2 / C4 / C5 / C6 / C7 中属于 core 的部分）。
 *
 * 依赖：spine-core.js（globalThis.SpineCore）、fixtures/cases.js（globalThis.SpineFixtures）。
 * 输出：页面顶部 PASS/FAIL 汇总 + 失败明细（期望/实际），并导出 window.__selftestResult。
 * 无 DOM 环境下（Node + 轻量 shim）也能运行，结果挂到 globalThis.__selftestResult。
 */
(function (global) {
  "use strict";

  var core = global.SpineCore;
  var fixtures = global.SpineFixtures; // case map：id -> case

  var result = {
    passed: 0,
    failed: 0,
    total: 0,
    cases: {},
    failures: [],
    startedAt: new Date().toISOString(),
  };
  var currentCase = "(global)";

  function fmt(v) {
    if (typeof v === "number") {
      if (!isFinite(v)) return String(v);
      return Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6 ? String(Math.round(v * 1e6) / 1e6) : v.toExponential(6);
    }
    if (Array.isArray(v)) return "[" + v.map(fmt).join(", ") + "]";
    if (v && typeof v.length === "number" && typeof v !== "string") {
      var arr = [];
      for (var i = 0; i < v.length; i++) arr.push(v[i]);
      return "[" + arr.map(fmt).join(", ") + "]";
    }
    if (v && typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function record(pass, name, expected, actual, detail) {
    result.total++;
    var c = result.cases[currentCase] || (result.cases[currentCase] = { passed: 0, failed: 0 });
    if (pass) {
      result.passed++;
      c.passed++;
      return true;
    }
    result.failed++;
    c.failed++;
    result.failures.push({
      case: currentCase,
      name: name,
      expected: expected === undefined ? null : expected,
      actual: actual === undefined ? null : actual,
      detail: detail || "",
    });
    return false;
  }

  function ok(name, cond, detail) {
    return record(!!cond, name, "truthy", cond, detail);
  }

  function eq(name, actual, expected) {
    return record(actual === expected, name, expected, actual);
  }

  function near(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    var pass = typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t;
    return record(pass, name, expected, actual, "tol=" + t);
  }

  function nearArray(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    if (!actual || !expected || actual.length !== expected.length) {
      return record(false, name, expected, actual, "长度不一致");
    }
    var max = 0;
    var at = -1;
    for (var i = 0; i < expected.length; i++) {
      var d = Math.abs(actual[i] - expected[i]);
      if (!isFinite(actual[i])) d = Infinity;
      if (d > max) {
        max = d;
        at = i;
      }
    }
    return record(max <= t, name, expected, actual, "最大误差 " + fmt(max) + " @[" + at + "] tol=" + t);
  }

  function eqArray(name, actual, expected) {
    if (!actual || !expected || actual.length !== expected.length) {
      return record(false, name, expected, actual, "长度不一致");
    }
    var same = true;
    for (var i = 0; i < expected.length; i++) if (actual[i] !== expected[i]) same = false;
    return record(same, name, expected, actual);
  }

  function allFinite(name, arr) {
    for (var i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) return record(false, name, "全部有限", arr[i], "index " + i);
    }
    return record(true, name, "全部有限", "全部有限");
  }

  function getAtt(model, slotName, attName) {
    return model.attachments.get(model.defaultSkinName + "/" + slotName + "/" + attName);
  }

  function attName(att) {
    var parts = att.id.split("/");
    return parts[parts.length - 1];
  }

  function parseFixture(f) {
    var atlasRes = core.parseAtlas(f.atlasText);
    if (!atlasRes.ok) return { atlasRes: atlasRes, modelRes: null };
    return { atlasRes: atlasRes, modelRes: core.parseModel(f.json, atlasRes.value, { skin: "default" }) };
  }

  /* ------------------------------------------------------------------ *
   * 通用 fixture 断言
   * ------------------------------------------------------------------ */
  function runFixture(f) {
    currentCase = f.id;
    var exp = f.expected || {};
    var parsed = parseFixture(f);
    ok("atlas 解析成功", parsed.atlasRes.ok, parsed.atlasRes.issues);
    if (!parsed.atlasRes.ok) return;

    if (exp.parseOk === false) {
      ok("parseModel 返回 ok:false", parsed.modelRes.ok === false);
      var errors = parsed.modelRes.issues.filter(function (i) {
        return i.severity === "error";
      });
      ok(
        "错误码 " + exp.errorCode,
        errors.some(function (i) {
          return i.code === exp.errorCode;
        }),
        errors
      );
      ok(
        "错误项带 path",
        errors.some(function (i) {
          return typeof i.path === "string";
        }),
        errors
      );
      return;
    }

    ok("parseModel 成功", parsed.modelRes.ok, parsed.modelRes.issues);
    if (!parsed.modelRes.ok) return;
    var model = parsed.modelRes.value;
    var issues = parsed.modelRes.issues;

    if (exp.counts) {
      eq("counts.bones", model.bones.length, exp.counts.bones);
      eq("counts.slots", model.slots.length, exp.counts.slots);
      var meshCount = 0;
      var weightedCount = 0;
      model.attachments.forEach(function (att) {
        if (att.type === "mesh") {
          meshCount++;
          if (att.weighted) weightedCount++;
        }
      });
      eq("counts.meshes", meshCount, exp.counts.meshes);
      eq("counts.weightedMeshes", weightedCount, exp.counts.weightedMeshes);
      eq("counts.ik", model.constraints.length, exp.counts.ik);
    }

    if (exp.issueCodes) {
      exp.issueCodes.forEach(function (code) {
        /* P2（T24）：deform 已求值 —— fixture 里遗留的 "animation.deform.unsupported" 期望在此升级为
           "不得再出现该告警"（fixture 文件不在本任务写域，真实行为见 runDeform）。 */
        if (code === "animation.deform.unsupported") {
          ok(
            "deform 已求值（不再报 " + code + "）",
            !issues.some(function (i) {
              return i.code === code;
            }),
            issues.map(function (i) {
              return i.code;
            })
          );
          return;
        }
        ok(
          "issue 存在 " + code,
          issues.some(function (i) {
            return i.code === code;
          }),
          issues.map(function (i) {
            return i.code;
          })
        );
      });
    }

    if (exp.atlas) {
      eq("atlas 页数", parsed.atlasRes.value.pages.length, exp.atlas.pages.length);
      exp.atlas.pages.forEach(function (p, i) {
        eq("page[" + i + "].name", parsed.atlasRes.value.pages[i].name, p.name);
        eq("page[" + i + "].width", parsed.atlasRes.value.pages[i].width, p.width);
        eq("page[" + i + "].height", parsed.atlasRes.value.pages[i].height, p.height);
      });
      eq("atlas region 数", parsed.atlasRes.value.regions.size, exp.atlas.regions.length);
      exp.atlas.regions.forEach(function (r) {
        var actual = parsed.atlasRes.value.regions.get(r.name);
        if (!actual) return record(false, "region " + r.name + " 存在", "存在", "缺失");
        var keys = ["pageIndex", "x", "y", "w", "h", "rotate", "offsetX", "offsetY", "originalW", "originalH"];
        keys.forEach(function (k) {
          eq("region " + r.name + "." + k, actual[k], r[k]);
        });
      });
    }

    if (exp.poses) {
      exp.poses.forEach(function (p) {
        var pose = core.evalPose(model, { animation: p.animation === undefined ? null : p.animation, time: p.time || 0 });
        allFinite("pose[" + p.label + "] world 全部有限", flattenWorld(pose.world));
        if (p.bones) {
          Object.keys(p.bones).forEach(function (name) {
            var idx = model.boneIndex.get(name);
            if (idx === undefined) return record(false, "骨 " + name + " 存在", "存在", "缺失");
            var w = pose.world[idx];
            nearArray("pose[" + p.label + "] 骨 " + name + " world", [w.a, w.b, w.c, w.d, w.tx, w.ty], p.bones[name], 1e-4);
          });
        }
        if (p.meshes) {
          p.meshes.forEach(function (m) {
            var att = getAtt(model, m.slot, m.attachment);
            if (!att) return record(false, "附件 " + m.slot + "/" + m.attachment + " 存在", "存在", "缺失");
            var slot = model.slots[att.slotIndex];
            var actual = core.skinMesh(att, slot.boneIndex, pose.world);
            nearArray("pose[" + p.label + "] mesh " + m.slot + "/" + m.attachment, actual, m.vertices, 1e-4);
          });
        }
        if (p.attachments) {
          var actualIds = pose.attachments.map(function (att) {
            return att ? attName(att) : null;
          });
          eqArray("pose[" + p.label + "] attachment 序列", actualIds, p.attachments);
        }
        if (exp.evalIssueCodes) {
          exp.evalIssueCodes.forEach(function (code) {
            ok(
              "pose[" + p.label + "] eval issue " + code,
              pose.issues.some(function (i) {
                return i.code === code;
              }),
              pose.issues.map(function (i) {
                return i.code;
              })
            );
          });
        }
      });
    }

    if (exp.sources) {
      exp.sources.forEach(function (s) {
        var att = getAtt(model, s.slot, s.attachment);
        if (!att || !att.region) return record(false, "附件 " + s.slot + "/" + s.attachment + " 有 region", "有", "缺失");
        var actual = core.uvToPageXY(att.region, s.uv);
        nearArray("source " + s.slot + "/" + s.attachment + " corner" + s.corner, [actual[0], actual[1]], [s.x, s.y], 1e-4);
      });
    }

    if (exp.weights) {
      exp.weights.forEach(function (w) {
        var att = getAtt(model, w.slot, w.attachment);
        if (!att) return record(false, "权重附件存在", "存在", "缺失");
        var palette = new Map();
        Object.keys(w.palette).forEach(function (k) {
          palette.set(Number(k), w.palette[k]);
        });
        var wc = core.weightColors(att, model.slots[att.slotIndex].boneIndex, palette);
        w.colors.forEach(function (color, vi) {
          nearArray("权重配色 " + w.slot + "/" + w.attachment + " v" + vi, [wc.rgb[vi * 3], wc.rgb[vi * 3 + 1], wc.rgb[vi * 3 + 2]], color, 1e-4);
        });
      });
    }

    if (exp.bounds || exp.hits || exp.emptyGeometry) {
      var pose = core.evalPose(model, { animation: null, time: 0 });
      var items = core.buildGeometry(model, pose);
      if (exp.emptyGeometry) {
        eq("无可见件 buildGeometry 为空", items.length, 0);
        eq("无可见件 boundsOf 为 null", core.boundsOf(items), null);
        eq("无可见件 hitTest 为 null", core.hitTest(items, { x: 0, y: 0 }), null);
      }
      if (exp.bounds) {
        var b = core.boundsOf(items);
        ok("bounds 非 null", b !== null);
        if (b) {
          near("bounds.minX", b.minX, exp.bounds.minX, 1e-4);
          near("bounds.minY", b.minY, exp.bounds.minY, 1e-4);
          near("bounds.maxX", b.maxX, exp.bounds.maxX, 1e-4);
          near("bounds.maxY", b.maxY, exp.bounds.maxY, 1e-4);
        }
      }
      if (exp.hits) {
        exp.hits.forEach(function (h) {
          var hit = core.hitTest(items, { x: h.point[0], y: h.point[1] });
          if (h.expect === null) {
            eq("hitTest (" + h.point + ") 未命中", hit, null);
          } else {
            ok("hitTest (" + h.point + ") 命中", hit !== null);
            if (hit) {
              eq("hitTest slot", model.slots[hit.slotIndex].name, h.expect);
              var sum = hit.barycentric[0] + hit.barycentric[1] + hit.barycentric[2];
              near("hitTest 重心和", sum, 1, 1e-6);
            }
          }
        });
      }
    }
  }

  function flattenWorld(world) {
    var out = [];
    for (var i = 0; i < world.length; i++) {
      var w = world[i];
      out.push(w.a, w.b, w.c, w.d, w.tx, w.ty);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 额外纯函数断言（不依赖 fixture 的通用性质）
   * ------------------------------------------------------------------ */
  function runExtra() {
    currentCase = "(core)";

    // ---- sampleTrack ----
    var lin = [{ time: 0, value: 0 }, { time: 1, value: 10 }];
    near("sampleTrack 线性中点", core.sampleTrack(lin, 0.5, ["value"], [0])[0], 5, 1e-12);
    near("sampleTrack 首 key 之前返回默认", core.sampleTrack([{ time: 0.5, value: 7 }], 0.1, ["value"], [3])[0], 3, 1e-12);
    near("sampleTrack 末 key 之后返回末值", core.sampleTrack([{ time: 0, value: 7 }], 5, ["value"], [3])[0], 7, 1e-12);
    var stepped = [{ time: 0, value: 3, curve: "stepped" }, { time: 1, value: 9 }];
    near("sampleTrack stepped", core.sampleTrack(stepped, 0.5, ["value"], [0])[0], 3, 1e-12);
    var sym = [{ time: 0, value: 0, curve: [0.3, 0, 0.7, 1] }, { time: 1, value: 1 }];
    near("sampleTrack Bezier 对称点", core.sampleTrack(sym, 0.5, ["value"], [0])[0], 0.5, 1e-9);
    var dual = [{ time: 0, x: 0, y: 0, curve: [0.2, 0, 0.8, 10, 0.2, 0, 0.8, 100] }, { time: 1, x: 10, y: 100 }];
    var dualVal = core.sampleTrack(dual, 0.5, ["x", "y"], [0, 0]);
    near("sampleTrack 双通道 x", dualVal[0], 5, 1e-6);
    near("sampleTrack 双通道 y", dualVal[1], 50, 1e-6);
    var outside = core.sampleTrack([{ time: 0, value: 0, curve: [2, 0, 3, 1] }, { time: 1, value: 1 }], 0.5, ["value"], [0]);
    ok("sampleTrack 离界控制点仍有限", isFinite(outside[0]));

    // 缺字段 key：Spine 语义是该 key 处取缺省值（translate 0 / rotate 0 / scale 1），
    // 且不得因为缺字段而丢弃 key（否则时间轴被压缩，采样整体错位）。
    var missT = [{ time: 0, x: 5, curve: "stepped" }, { time: 0.5, x: 7, curve: "stepped" }];
    var missTv = core.sampleTrack(missT, 0.25, ["x", "y"], [0, 0]);
    near("缺 y 的 translate key：x 取本段", missTv[0], 5, 1e-12);
    near("缺 y 的 translate key：y=0", missTv[1], 0, 1e-12);
    eq("缺 y 的 translate key 未被过滤", missT.length, 2);
    var missR = [{ time: 0, value: 7, curve: "stepped" }, { time: 0.5, curve: "stepped" }];
    near("缺 value 的 rotate key：前一段取 7", core.sampleTrack(missR, 0.25, ["value"], [0])[0], 7, 1e-12);
    near("缺 value 的 rotate key：本 key 处取 0", core.sampleTrack(missR, 0.5, ["value"], [0])[0], 0, 1e-12);
    var missS = [{ time: 0, x: 2, curve: "stepped" }, { time: 0.5, curve: "stepped" }];
    var missSv = core.sampleTrack(missS, 0.25, ["x", "y"], [1, 1]);
    near("缺 x/y 的 scale key：x 取本段", missSv[0], 2, 1e-12);
    near("缺 x/y 的 scale key：y=1", missSv[1], 1, 1e-12);
    // 官方 4.2 把 key 时间存进 Float32Array；0.6 存成 0.6000000238，
    // 因此 Timeline.search 在查询 time=0.6 时取到上一个 key。这里锁定该语义（与官方 oracle 一致）。
    var f32keys = [{ time: 0, value: 10, curve: "stepped" }, { time: 0.6, value: 60, curve: "stepped" }];
    near("float32 key 时间：t=0.6 取上一 key（官方 Timeline.search 语义）", core.sampleTrack(f32keys, 0.6, ["value"], [0])[0], 10, 1e-12);

    // fixture：缺字段 key 在解析后必须全部保留且归一化到缺省值
    var fstep = fixtures["stepped-missing-fields"];
    var mstep = parseFixture(fstep).modelRes.value;
    var stepTracks = mstep.animations.get("step").bones.get(mstep.boneIndex.get("b"));
    eq("缺字段 key 全部保留（translate）", stepTracks.translate.keys.length, 5);
    eq("缺字段 key 全部保留（rotate）", stepTracks.rotate.keys.length, 4);
    eq("缺字段 key 全部保留（scale）", stepTracks.scale.keys.length, 4);
    near("translate 缺 y 的 key 归一化为 0", stepTracks.translate.keys[2].y, 0, 1e-12);
    near("rotate 缺 value 的 key 归一化为 0", stepTracks.rotate.keys[1].value, 0, 1e-12);
    near("scale 缺 x 的 key 归一化为 1", stepTracks.scale.keys[1].x, 1, 1e-12);
    near("scale 缺 y 的 key 归一化为 1", stepTracks.scale.keys[1].y, 1, 1e-12);

    // ---- Mat ----
    var m = { a: 2, b: 1, c: -1, d: 3, tx: 10, ty: -4 };
    var inv = core.invert(m);
    ok("invert 非奇异返回矩阵", inv !== null);
    var id = core.matMul(m, inv);
    nearArray("matMul(m, invert(m)) ≈ I", [id.a, id.b, id.c, id.d, id.tx, id.ty], [1, 0, 0, 1, 0, 0], 1e-9);
    eq("invert 奇异返回 null", core.invert({ a: 1, b: 2, c: 2, d: 4 }), null);
    var p = core.transformPoint(m, { x: 3, y: 4 });
    near("transformPoint.x", p.x, 12, 1e-12);
    near("transformPoint.y", p.y, 11, 1e-12);
    var mm = core.matMul(m, { a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 2 });
    near("matMul 平移 x", mm.tx, 10, 1e-12);
    near("matMul 平移 y", mm.ty, 3, 1e-12);

    // ---- affineFromTriangles ----
    var src = [0, 0, 10, 0, 0, 10];
    var dst = [5, 5, 15, 5, 5, 15];
    var affine = core.affineFromTriangles(src, dst);
    ok("affineFromTriangles 返回矩阵", affine !== null);
    if (affine) {
      var q0 = core.transformPoint(affine, { x: 0, y: 0 });
      var q1 = core.transformPoint(affine, { x: 10, y: 0 });
      var q2 = core.transformPoint(affine, { x: 0, y: 10 });
      nearArray("affine 三点映射", [q0.x, q0.y, q1.x, q1.y, q2.x, q2.y], dst, 1e-9);
    }
    eq("affineFromTriangles 奇异返回 null", core.affineFromTriangles([0, 0, 10, 0, 20, 0], dst), null);

    // ---- uvToPageXY 未裁剪简化 ----
    var flat = { x: 10, y: 20, w: 40, h: 30, originalW: 40, originalH: 30, offsetX: 0, offsetY: 0, rotate: 0 };
    var uv00 = core.uvToPageXY(flat, [0, 0]);
    var uv11 = core.uvToPageXY(flat, [1, 1]);
    nearArray("uvToPageXY 未裁剪 (0,0)", [uv00[0], uv00[1]], [10, 20], 1e-12);
    nearArray("uvToPageXY 未裁剪 (1,1)", [uv11[0], uv11[1]], [50, 50], 1e-12);

    // ---- 空输入安全 ----
    eq("boundsOf([]) 为 null", core.boundsOf([]), null);
    eq("hitTest 空 items 为 null", core.hitTest([], { x: 0, y: 0 }), null);
    eq("hitTest 无 point 为 null", core.hitTest([{ bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 }, triangles: [0, 1, 2], worldXY: [0, 0, 1, 0, 0, 1] }], null), null);

    // ---- 无效模型 ----
    var badPose = core.evalPose(null, {});
    eq("evalPose(null) 返回空姿势", badPose.world.length, 0);
    eq("evalPose(null) 有 error issue", badPose.issues[0].severity, "error");
    var badModel = core.parseModel({}, null);
    ok("parseModel 缺 atlas 返回 ok:false", badModel.ok === false);
    var badAtlas = core.parseAtlas(123);
    ok("parseAtlas 非字符串返回 ok:false", badAtlas.ok === false);

    // ---- 真实 fixture 的语义断言 ----
    var F = fixtures;

    // C2：刚性 mesh 的 width/height 不影响几何
    var f2 = F["rigid-mesh-concave"];
    var base2 = parseFixture(f2).modelRes.value;
    var pose2 = core.evalPose(base2, {});
    var att2 = getAtt(base2, "shape", "shape");
    var v0 = core.skinMesh(att2, base2.slots[att2.slotIndex].boneIndex, pose2.world);
    var mutated = JSON.parse(JSON.stringify(f2.json));
    mutated.skins[0].attachments.shape.shape.width = 999;
    mutated.skins[0].attachments.shape.shape.height = 999;
    var m2b = core.parseModel(mutated, core.parseAtlas(f2.atlasText).value).value;
    var pose2b = core.evalPose(m2b, {});
    var att2b = getAtt(m2b, "shape", "shape");
    nearArray("mesh width/height 改成 999 不改变 worldXY", core.skinMesh(att2b, m2b.slots[att2b.slotIndex].boneIndex, pose2b.world), v0, 1e-12);

    // 改 uv 不改 worldXY，但改 sourceXY
    var uvMut = JSON.parse(JSON.stringify(f2.json));
    uvMut.skins[0].attachments.shape.shape.uvs = [0.1, 0.9, 0.9, 0.9, 0.9, 0.1, 0.5, 0.5, 0.1, 0.1];
    var m2c = core.parseModel(uvMut, core.parseAtlas(f2.atlasText).value).value;
    var att2c = getAtt(m2c, "shape", "shape");
    nearArray("改 uv 不改变 worldXY", core.skinMesh(att2c, m2c.slots[att2c.slotIndex].boneIndex, core.evalPose(m2c, {}).world), v0, 1e-12);
    var srcA = core.uvToPageXY(att2.region, att2.uv);
    var srcB = core.uvToPageXY(att2c.region, att2c.uv);
    ok("改 uv 会改变 sourceXY", Math.abs(srcA[0] - srcB[0]) > 1e-6);

    // 改 vertices 不改 sourceXY
    var vMut = JSON.parse(JSON.stringify(f2.json));
    vMut.skins[0].attachments.shape.shape.vertices = [0, 0, 110, 0, 110, 40, 60, 10, 0, 40];
    var m2d = core.parseModel(vMut, core.parseAtlas(f2.atlasText).value).value;
    var att2d = getAtt(m2d, "shape", "shape");
    nearArray("改 vertices 不改变 sourceXY", core.uvToPageXY(att2d.region, att2d.uv), srcA, 1e-12);
    ok("改 vertices 会改变 worldXY", Math.abs(core.skinMesh(att2d, m2d.slots[att2d.slotIndex].boneIndex, core.evalPose(m2d, {}).world)[2] - v0[2]) > 1e-6);

    // edges 归一化
    nearArray("edges 归一化为顶点索引", Array.from(att2.edges), [0, 1, 1, 2, 2, 3, 3, 4, 4, 0], 0);
    eq("hullCount 是顶点个数", att2.hullCount, 5);
    eq("三角形索引个数", att2.triangles.length, 9);

    // C2：加权解码段数 = N、每段对应 uv pair、Σ 权重坐标误差 < 1e-6
    var f3 = F["weighted-mesh"];
    var m3 = parseFixture(f3).modelRes.value;
    var att3 = getAtt(m3, "skin", "wmesh");
    eq("加权 vertexCount", att3.vertexCount, 4);
    eq("加权 influences 段数 = N", att3.influences.length, att3.vertexCount);
    eq("uv 长度 = 2N", att3.uv.length, att3.vertexCount * 2);
    var pose3 = core.evalPose(m3, {});
    var skinned3 = core.skinMesh(att3, m3.slots[att3.slotIndex].boneIndex, pose3.world);
    var manual = new Float64Array(att3.vertexCount * 2);
    for (var vi = 0; vi < att3.vertexCount; vi++) {
      var list = att3.influences[vi];
      var wx = 0;
      var wy = 0;
      for (var k = 0; k < list.length; k++) {
        var inf = list[k];
        var bm = pose3.world[inf.boneIndex];
        wx += inf.weight * (bm.a * inf.x + bm.c * inf.y + bm.tx);
        wy += inf.weight * (bm.b * inf.x + bm.d * inf.y + bm.ty);
      }
      manual[vi * 2] = wx;
      manual[vi * 2 + 1] = wy;
    }
    nearArray("加权顶点 Σw·W·bind 与 skinMesh 一致", skinned3, manual, 1e-6);
    eq("influence[0] 数量为 1", att3.influences[0].length, 1);
    eq("influence[1] 数量为 2", att3.influences[1].length, 2);
    near("v1 权重和", att3.influences[1][0].weight + att3.influences[1][1].weight, 1, 1e-9);
    // 改骨后加权顶点移动
    var boneMoved = core.evalPose(m3, { edits: { bones: new Map([["A", { x: 200 }]]) } });
    var moved = core.skinMesh(att3, m3.slots[att3.slotIndex].boneIndex, boneMoved.world);
    ok("改骨后加权顶点移动", Math.abs(moved[0] - skinned3[0]) > 1);

    // C4：权重配色 1/0、0/1、0.5/0.5
    var palette = new Map([[1, [1, 0, 0]], [2, [0, 1, 0]]]);
    var wc = core.weightColors(att3, m3.slots[att3.slotIndex].boneIndex, palette);
    nearArray("权重 v0 = A 色", [wc.rgb[0], wc.rgb[1], wc.rgb[2]], [1, 0, 0], 1e-9);
    nearArray("权重 v2 = B 色", [wc.rgb[6], wc.rgb[7], wc.rgb[8]], [0, 1, 0], 1e-9);
    nearArray("权重 v1 = 二色平均", [wc.rgb[3], wc.rgb[4], wc.rgb[5]], [0.5, 0.5, 0], 1e-9);
    var heat = core.weightColors(att3, m3.slots[att3.slotIndex].boneIndex, palette, 1);
    nearArray("热力图 = 所选骨权重", Array.from(heat.heat), [1, 0.5, 0, 0.25], 1e-9);
    eq("图例只列用到的骨", heat.legend.length, 2);
    eq("图例含骨名", heat.legend[0].name, "A");
    near("图例 maxWeight", heat.legend[0].maxWeight, 1, 1e-9);

    var f1 = F["region-transform"];
    var m1 = parseFixture(f1).modelRes.value;
    var att1 = getAtt(m1, "body", "region-big");
    var rigidColors = core.weightColors(att1, m1.slots[att1.slotIndex].boneIndex, palette);
    eq("刚性附件图例 1 项", rigidColors.legend.length, 1);
    near("刚性附件权重 100%", rigidColors.legend[0].maxWeight, 1, 1e-12);
    eq("刚性附件无热力图", rigidColors.heat, undefined);

    // C5：IK 几何断言
    var f5 = F["ik-two-bone"];
    var m5 = parseFixture(f5).modelRes.value;
    var pose5 = core.evalPose(m5, {});
    var cIdx = m5.boneIndex.get("C");
    var cBone = m5.bones[cIdx];
    var tip = { x: pose5.world[cIdx].a * cBone.length + pose5.world[cIdx].tx, y: pose5.world[cIdx].b * cBone.length + pose5.world[cIdx].ty };
    var target = pose5.world[m5.boneIndex.get("T1")];
    near("二骨 IK 末端到 target 距离", Math.hypot(tip.x - target.tx, tip.y - target.ty), 0, 1e-4);
    near("二骨 IK 正 bend 父角", normDeg(pose5.applied[m5.boneIndex.get("P")].rotation), 0, 1e-6);
    near("二骨 IK 正 bend 子角", normDeg(pose5.applied[cIdx].rotation), 90, 1e-6);

    var f5n = F["ik-two-bendneg"];
    var m5n = parseFixture(f5n).modelRes.value;
    var pose5n = core.evalPose(m5n, {});
    near("二骨 IK 负 bend 父角", normDeg(pose5n.applied[m5n.boneIndex.get("P")].rotation), 90, 1e-6);
    near("二骨 IK 负 bend 子角", normDeg(pose5n.applied[m5n.boneIndex.get("C")].rotation), -90, 1e-6);

    var f5m0 = F["ik-two-mix0"];
    var m5m0 = parseFixture(f5m0).modelRes.value;
    var pose5m0 = core.evalPose(m5m0, {});
    var fk5 = core.evalPose(m5m0, {});
    nearArray("mix0 与 FK 逐矩阵相等", flattenWorld(pose5m0.world), flattenWorld(fk5.world), 1e-12);

    var f5far = F["ik-two-far"];
    var m5far = parseFixture(f5far).modelRes.value;
    var pose5far = core.evalPose(m5far, {});
    var ci = m5far.boneIndex.get("C");
    var tipFar = { x: pose5far.world[ci].a * m5far.bones[ci].length + pose5far.world[ci].tx, y: pose5far.world[ci].b * m5far.bones[ci].length + pose5far.world[ci].ty };
    near("无 stretch 远目标末端距根", Math.hypot(tipFar.x, tipFar.y), 200, 1e-4);

    var f5st = F["ik-two-far-stretch"];
    var m5st = parseFixture(f5st).modelRes.value;
    var pose5st = core.evalPose(m5st, {});
    near("stretch 父骨 scaleX", pose5st.applied[m5st.boneIndex.get("P")].scaleX, 1.5, 1e-9);
    var cs = m5st.boneIndex.get("C");
    var tipSt = { x: pose5st.world[cs].a * m5st.bones[cs].length + pose5st.world[cs].tx, y: pose5st.world[cs].b * m5st.bones[cs].length + pose5st.world[cs].ty };
    near("stretch 末端到 target", Math.hypot(tipSt.x - 300, tipSt.y), 0, 1e-4);

    var f5o = F["ik-one-bone"];
    var m5o = parseFixture(f5o).modelRes.value;
    var pose5o = core.evalPose(m5o, {});
    near("一骨 compress scaleX", pose5o.applied[m5o.boneIndex.get("arm")].scaleX, 0.5, 1e-9);
    var armIdx = m5o.boneIndex.get("arm");
    var armTip = { x: pose5o.world[armIdx].a * m5o.bones[armIdx].length + pose5o.world[armIdx].tx, y: pose5o.world[armIdx].b * m5o.bones[armIdx].length + pose5o.world[armIdx].ty };
    near("一骨 compress 末端到 target", Math.hypot(armTip.x - 50, armTip.y), 0, 1e-4);
    var f5u = F["ik-one-uniform"];
    var m5u = parseFixture(f5u).modelRes.value;
    var pose5u = core.evalPose(m5u, {});
    near("一骨 uniform scaleY", pose5u.applied[m5u.boneIndex.get("arm")].scaleY, 0.5, 1e-9);

    // softness 阈值连续性：1e-4 与无 softness 结果一致（连续边界）
    var f5s = F["ik-two-softness-1e-4"];
    var m5s = parseFixture(f5s).modelRes.value;
    var pose5s = core.evalPose(m5s, {});
    nearArray("softness 1e-4 与无 softness 连续", flattenWorld(pose5s.world), flattenWorld(pose5far.world), 1e-6);
    var f5s50 = F["ik-two-softness-50"];
    var m5s50 = parseFixture(f5s50).modelRes.value;
    var pose5s50 = core.evalPose(m5s50, {});
    allFinite("softness 50 结果有限", flattenWorld(pose5s50.world));

    // order 交换结果不同
    var f5oa = F["ik-two-order-a"];
    var f5ob = F["ik-two-order-b"];
    var m5oa = parseFixture(f5oa).modelRes.value;
    var m5ob = parseFixture(f5ob).modelRes.value;
    var pose5oa = core.evalPose(m5oa, {});
    var pose5ob = core.evalPose(m5ob, {});
    var dIdxA = m5oa.boneIndex.get("D");
    var diffOrder = Math.max(
      Math.abs(pose5oa.world[dIdxA].tx - pose5ob.world[dIdxA].tx),
      Math.abs(pose5oa.world[dIdxA].ty - pose5ob.world[dIdxA].ty)
    );
    ok("order 交换两约束结果不同", diffOrder > 1e-3, "D 世界差 " + fmt(diffOrder));
    // 后代 mesh 跟随：order 交换后 D 上的 mesh 顶点不同
    var attA = getAtt(m5oa, "chain", "dmesh");
    var attB = getAtt(m5ob, "chain", "dmesh");
    var vA = core.skinMesh(attA, m5oa.slots[attA.slotIndex].boneIndex, pose5oa.world);
    var vB = core.skinMesh(attB, m5ob.slots[attB.slotIndex].boneIndex, pose5ob.world);
    ok("order 交换后后代 mesh 跟随", Math.hypot(vA[0] - vB[0], vA[1] - vB[1]) > 1e-3);

    // 镜像 / 非均匀 / 复杂 inherit：明确 issue、无 NaN
    ["ik-mirror", "ik-nonuniform", "ik-bad-inherit"].forEach(function (id) {
      var m = parseFixture(F[id]).modelRes.value;
      var pose = core.evalPose(m, {});
      allFinite(id + " 无 NaN", flattenWorld(pose.world));
      ok(id + " 有 IK unsupported issue", pose.issues.some(function (i) { return i.code.indexOf("ik.unsupported") === 0; }), pose.issues.map(function (i) { return i.code; }));
    });

    // C6：隐藏件跳过；凹 mesh 空白点不命中（fixture ② 已覆盖空白点）
    var items2 = core.buildGeometry(base2, pose2);
    var hidden = new Set(["shape"]);
    eq("hidden 按 slot 名跳过", core.buildGeometry(base2, pose2, { hidden: hidden }).length, 0);
    var hiddenById = new Set([att2.id]);
    eq("hidden 按 attachment id 跳过", core.buildGeometry(base2, pose2, { hidden: hiddenById }).length, 0);
    ok("可见件几何非空", items2.length > 0);
    eq("DrawItem.pageIndex 与 region 一致", items2[0].pageIndex, att2.region.pageIndex);

    // C7：不支持特性不修改 raw
    var f8 = F["unsupported-diagnostics"];
    var rawBefore = JSON.stringify(f8.json);
    var parsed8 = parseFixture(f8);
    core.evalPose(parsed8.modelRes.value, { animation: "unsupported", time: 0.25 });
    eq("解析/求值不修改 raw JSON", JSON.stringify(f8.json), rawBefore);

    // 附件动画 name:null 卸载
    var fnull = F["null-attachment-animation"];
    var mnull = parseFixture(fnull).modelRes.value;
    eq("attachment 动画卸载 @0.75", core.evalPose(mnull, { animation: "hide", time: 0.75 }).attachments[0], null);
    ok("attachment 动画恢复 @1", core.evalPose(mnull, { animation: "hide", time: 1 }).attachments[0] !== null);

    // 缺失动画：warning + setup 姿势
    var missAnim = core.evalPose(m1, { animation: "nope", time: 0 });
    ok("缺失动画返回 warning", missAnim.issues.some(function (i) { return i.code === "pose.animation.missing"; }));

    // 多 page atlas
    var f4 = F["atlas-rotations-trim"];
    var atlas4 = core.parseAtlas(f4.atlasText).value;
    eq("多 page atlas 页数", atlas4.pages.length, 2);
    eq("page-b 名称", atlas4.pages[1].name, "case4-b.png");
    eq("page-b region pageIndex", atlas4.regions.get("p2").pageIndex, 1);
    eq("缺省 original 回退为 w/h", atlas4.regions.get("flat").originalW, 64);

    // fixture 覆盖率自检
    var ids = Object.keys(F);
    ok("fixture 覆盖 ①–⑧（≥8 主用例）", ids.length >= 8, ids.length);
    ok("fixture 含退化用例", ids.some(function (id) { return F[id].group === "degenerate"; }));
    var examples = Object.keys(fixtures).filter(function (id) { return fixtures[id].example; });
    ok("fixture 含示例用例", examples.length >= 4, examples);
  }

  /* ------------------------------------------------------------------ *
   * bundle.js 纯函数断言（契约 §5.3）：索引 / 路径 / 补丁 / ZIP
   * 只测无 DOM/fetch 的纯函数；服务端 Origin/大小/路径与服务集成验证不属于这里。
   * ------------------------------------------------------------------ */
  function runBundle() {
    var B = global.SpineBundle;
    currentCase = "(bundle)";
    if (!B) {
      record(false, "SpineBundle 未加载", "存在", "缺失", "");
      return;
    }

    var enc = function (s) {
      return new TextEncoder().encode(s);
    };
    var same = function (a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    };
    var bytesEqual = function (a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };
    var mutate = function (base, fn) {
      var o = JSON.parse(JSON.stringify(base));
      fn(o);
      return o;
    };

    /* ---- crc32：标准向量 / 无符号 / 不修改输入 ---- */
    eq("crc32 空字节 = 0", B.crc32(new Uint8Array(0)), 0);
    eq("crc32 ASCII '123456789' = 0xcbf43926", B.crc32(enc("123456789")), 0xcbf43926);
    eq("crc32 含 0/255 二进制固定向量", B.crc32(new Uint8Array([0, 255, 0, 255, 127, 128])), 0x8021b4db);
    eq("crc32 返回无符号 32 位", B.crc32(new Uint8Array([0])), 0xd202ef8d);
    var crcIn = new Uint8Array([1, 2, 3]);
    B.crc32(crcIn);
    ok("crc32 不修改输入", crcIn[0] === 1 && crcIn[1] === 2 && crcIn[2] === 3);

    /* ---- buildZipStore：逐偏移验证 local/central/EOCD ---- */
    var e1 = { name: "index.json", bytes: enc('{"schemaVersion":1}') };
    var e2 = { name: "model.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x00, 0x80]) };
    var built = B.buildZipStore([e1, e2]);
    ok("buildZipStore 两条目构建成功", built.ok === true, JSON.stringify(built.issues || []));
    var zip = built.value;
    var view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    var n1 = enc(e1.name).length;
    var n2 = enc(e2.name).length;
    var expectLen =
      30 + n1 + e1.bytes.length + (30 + n2 + e2.bytes.length) + (46 + n1) + (46 + n2) + 22;
    eq("ZIP 总长度 = 预检公式", zip.length, expectLen);
    eq("local #1 签名", view.getUint32(0, true), 0x04034b50);
    eq("local #1 version-needed=20", view.getUint16(4, true), 20);
    eq("local #1 UTF-8 标志 0x0800", view.getUint16(6, true), 0x0800);
    eq("local #1 method=0 store", view.getUint16(8, true), 0);
    eq("local #1 DOS time 固定 0", view.getUint16(10, true), 0);
    eq("local #1 DOS date 固定 0x0021", view.getUint16(12, true), 0x0021);
    eq("local #1 CRC", view.getUint32(14, true), B.crc32(e1.bytes) >>> 0);
    eq("local #1 压缩长度=原始长度", view.getUint32(18, true), e1.bytes.length);
    eq("local #1 原始长度", view.getUint32(22, true), e1.bytes.length);
    eq("local #1 文件名长度 (UTF-8 字节)", view.getUint16(26, true), n1);
    eq("local #1 extra 长度 0", view.getUint16(28, true), 0);
    eq("local #1 文件名 UTF-8 解码", new TextDecoder().decode(zip.subarray(30, 30 + n1)), e1.name);
    ok("local #1 内容是原字节", bytesEqual(zip.subarray(30 + n1, 30 + n1 + e1.bytes.length), e1.bytes));
    var off2 = 30 + n1 + e1.bytes.length;
    eq("local #2 签名", view.getUint32(off2, true), 0x04034b50);
    eq("local #2 CRC", view.getUint32(off2 + 14, true), B.crc32(e2.bytes) >>> 0);
    eq("local #2 方法 store", view.getUint16(off2 + 8, true), 0);
    eq("local #2 文件名", new TextDecoder().decode(zip.subarray(off2 + 30, off2 + 30 + n2)), e2.name);
    ok("local #2 内容是原字节", bytesEqual(zip.subarray(off2 + 30 + n2, off2 + 30 + n2 + e2.bytes.length), e2.bytes));
    var c1 = off2 + 30 + n2 + e2.bytes.length;
    eq("central #1 签名", view.getUint32(c1, true), 0x02014b50);
    eq("central #1 made-by=20", view.getUint16(c1 + 4, true), 20);
    eq("central #1 needed=20", view.getUint16(c1 + 6, true), 20);
    eq("central #1 UTF-8 标志", view.getUint16(c1 + 8, true), 0x0800);
    eq("central #1 method=0", view.getUint16(c1 + 10, true), 0);
    eq("central #1 DOS time", view.getUint16(c1 + 12, true), 0);
    eq("central #1 DOS date", view.getUint16(c1 + 14, true), 0x0021);
    eq("central #1 CRC", view.getUint32(c1 + 16, true), B.crc32(e1.bytes) >>> 0);
    eq("central #1 压缩长度", view.getUint32(c1 + 20, true), e1.bytes.length);
    eq("central #1 原始长度", view.getUint32(c1 + 24, true), e1.bytes.length);
    eq("central #1 文件名长度", view.getUint16(c1 + 28, true), n1);
    eq("central #1 extra=0", view.getUint16(c1 + 30, true), 0);
    eq("central #1 comment=0", view.getUint16(c1 + 32, true), 0);
    eq("central #1 disk-start=0", view.getUint16(c1 + 34, true), 0);
    eq("central #1 内部属性=0", view.getUint16(c1 + 36, true), 0);
    eq("central #1 外部属性=0", view.getUint32(c1 + 38, true), 0);
    eq("central #1 local offset", view.getUint32(c1 + 42, true), 0);
    eq("central #1 文件名", new TextDecoder().decode(zip.subarray(c1 + 46, c1 + 46 + n1)), e1.name);
    var c2 = c1 + 46 + n1;
    eq("central #2 签名", view.getUint32(c2, true), 0x02014b50);
    eq("central #2 local offset", view.getUint32(c2 + 42, true), off2);
    var eocd = zip.length - 22;
    eq("EOCD 签名", view.getUint32(eocd, true), 0x06054b50);
    eq("EOCD disk=0", view.getUint16(eocd + 4, true), 0);
    eq("EOCD start-disk=0", view.getUint16(eocd + 6, true), 0);
    eq("EOCD 本盘条目数", view.getUint16(eocd + 8, true), 2);
    eq("EOCD 总条目数", view.getUint16(eocd + 10, true), 2);
    eq("EOCD central 尺寸", view.getUint32(eocd + 12, true), zip.length - 22 - c1);
    eq("EOCD central 偏移", view.getUint32(eocd + 16, true), c1);
    eq("EOCD comment 长度 0", view.getUint16(eocd + 20, true), 0);
    ok("ZIP 无前后多余字节", zip.length === eocd + 22);
    var zipAgain = B.buildZipStore([e1, e2]).value;
    ok("相同输入生成字节完全相同", bytesEqual(zip, zipAgain));
    ok("buildZipStore 不修改输入条目", bytesEqual(e1.bytes, enc('{"schemaVersion":1}')) && bytesEqual(e2.bytes, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x00, 0x80])));

    /* ---- ZIP 拒绝与限额预检（不为 4GiB 边界分配内存） ---- */
    ok("ZIP 拒绝空条目清单", B.buildZipStore([]).ok === false);
    ok("ZIP 拒绝重名（不区分大小写）", B.buildZipStore([{ name: "model.png", bytes: e2.bytes }, { name: "MODEL.PNG", bytes: e2.bytes }]).ok === false);
    ok("ZIP 拒绝带目录的条目名", B.buildZipStore([{ name: "sub/model.png", bytes: e2.bytes }]).ok === false);
    ok("ZIP 拒绝非 Uint8Array 内容", B.buildZipStore([{ name: "model.png", bytes: [1, 2, 3] }]).ok === false);
    var many = [];
    for (var mi = 0; mi < 20; mi++) many.push({ name: "f" + mi + ".png", bytes: e2.bytes });
    ok("ZIP 条目上限 19（20 拒绝 / 19 通过）", B.checkZipEntries(many).ok === false && B.checkZipEntries(many.slice(0, 19)).ok === true);
    var fakeHuge = { length: 0x100000000 };
    Object.defineProperty(fakeHuge, Symbol.toStringTag, { value: "Uint8Array" });
    var overflow = B.checkZipEntries([{ name: "huge.png", bytes: fakeHuge }]);
    ok(
      "ZIP32 溢出由预检尺寸函数拒绝",
      overflow.ok === false && overflow.issues.some(function (i) { return i.code === "ZIP32_OVERFLOW"; })
    );

    /* ---- validateIndex：主包 / legacy / 多页 / 负例 ---- */
    var mainIdx = {
      schemaVersion: 1,
      base: "assets/characters/deepseek/spine",
      label: "deepseek 女仆",
      files: { model: "model.json", atlas: "model.atlas", textures: ["model.png"] },
    };
    var mainBefore = JSON.stringify(mainIdx);
    var vMain = B.validateIndex(mainIdx);
    ok("validateIndex 主包索引合法", vMain.ok === true, JSON.stringify(vMain.issues || []));
    ok("validateIndex 输出规范化（同字段同序）", same(vMain.value, mainIdx));
    ok("validateIndex 不修改调用者对象", JSON.stringify(mainIdx) === mainBefore);
    var legacy = {
      schemaVersion: 1,
      base: "assets/characters/deepseek/spine/legacy-views",
      files: { model: "model.json", atlas: "model.atlas", textures: ["model.png"] },
    };
    ok("validateIndex legacy 索引（无 label）合法", B.validateIndex(legacy).ok === true);
    var multi = {
      schemaVersion: 1,
      base: "assets/x",
      files: { model: "m.json", atlas: "m.atlas", textures: ["m.png", "m-2.webp"] },
    };
    ok("validateIndex 多页贴图合法", B.validateIndex(multi).ok === true);
    ok("validateIndex 缺 schemaVersion 拒绝", B.validateIndex(mutate(mainIdx, function (o) { delete o.schemaVersion; })).ok === false);
    ok("validateIndex schemaVersion \"1\" 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.schemaVersion = "1"; })).ok === false);
    ok("validateIndex schemaVersion true 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.schemaVersion = true; })).ok === false);
    ok("validateIndex schemaVersion 2 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.schemaVersion = 2; })).ok === false);
    ok("validateIndex 未知顶层字段拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.extra = 1; })).ok === false);
    ok("validateIndex 缺 files.model 拒绝", B.validateIndex(mutate(mainIdx, function (o) { delete o.files.model; })).ok === false);
    ok("validateIndex model 非 .json 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.files.model = "model.png"; })).ok === false);
    ok("validateIndex model=index.json 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.files.model = "index.json"; })).ok === false);
    ok("validateIndex 贴图空数组拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.files.textures = []; })).ok === false);
    ok("validateIndex 贴图超过 16 页拒绝", B.validateIndex(mutate(mainIdx, function (o) {
      o.files.textures = [];
      for (var ti = 0; ti < 17; ti++) o.files.textures.push("p" + ti + ".png");
    })).ok === false);
    ok("validateIndex 贴图重复拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.files.textures = ["model.png", "model.png"]; })).ok === false);
    ok("validateIndex 贴图大小写冲突拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.files.textures = ["model.png", "MODEL.png"]; })).ok === false);
    var label120 = new Array(121).join("字");
    ok("validateIndex label 120 字符通过", B.validateIndex(mutate(mainIdx, function (o) { o.label = label120; })).ok === true);
    ok("validateIndex label 121 字符拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.label = label120 + "字"; })).ok === false);
    ok("validateIndex 绝对 base 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.base = "/assets/x"; })).ok === false);
    ok("validateIndex .. 段 base 拒绝", B.validateIndex(mutate(mainIdx, function (o) { o.base = "assets/../x"; })).ok === false);
    var noBaseIdx = mutate(mainIdx, function (o) { delete o.base; });
    ok("validateIndex 缺 base（picker 语义）拒绝", B.validateIndex(noBaseIdx).ok === false);
    ok("validateIndex 缺 base 可放宽（URL 语义）", B.validateIndex(noBaseIdx, { requireBase: false }).ok === true);

    /* ---- validateFilename / validateBase ---- */
    ok("validateFilename 正常 basename", B.validateFilename("model.png").ok === true);
    ok("validateFilename 拒绝首字符点", B.validateFilename(".model.png").ok === false);
    ok("validateFilename 拒绝斜杠", B.validateFilename("a/model.png").ok === false);
    ok("validateFilename 拒绝反斜杠", B.validateFilename("a\\model.png").ok === false);
    ok("validateFilename 拒绝盘符冒号", B.validateFilename("C:model.png").ok === false);
    ok("validateFilename 拒绝百分号", B.validateFilename("model%2epng").ok === false);
    ok("validateFilename 拒绝 ..", B.validateFilename("..").ok === false);
    ok("validateFilename 拒绝 Windows 设备名", B.validateFilename("con.png").ok === false);
    ok("validateFilename 拒绝 129 字符", B.validateFilename(new Array(126).join("b") + ".png").ok === false);
    ok("validateFilename 接受 128 字符边界", B.validateFilename(new Array(125).join("b") + ".png").ok === true);
    ok("validateBase 正常相对目录", B.validateBase("assets/characters/deepseek/spine").ok === true);
    ok("validateBase 拒绝绝对路径", B.validateBase("/assets/x").ok === false);
    ok("validateBase 拒绝 .. 段", B.validateBase("assets/../x").ok === false);
    ok("validateBase 拒绝空段", B.validateBase("assets//x").ok === false);
    ok("validateBase 拒绝结尾斜杠", B.validateBase("assets/x/").ok === false);
    ok("validateBase 拒绝协议", B.validateBase("https://x").ok === false);
    ok("validateBase 拒绝反斜杠", B.validateBase("assets\\x").ok === false);
    ok("validateBase 拒绝百分号", B.validateBase("assets/%2e%2e/x").ok === false);

    /* ---- parseIndexParam / resolveIndexLocation ---- */
    var pi = B.parseIndexParam("assets/characters/deepseek/spine/index.json");
    ok("parseIndexParam 正常路径", pi.ok === true && pi.value.observedBase === "assets/characters/deepseek/spine");
    ok("parseIndexParam 拒绝起始斜杠", B.parseIndexParam("/assets/x/index.json").ok === false);
    ok("parseIndexParam 拒绝非 index.json 结尾", B.parseIndexParam("assets/x/model.json").ok === false);
    ok("parseIndexParam 拒绝 .. 段", B.parseIndexParam("assets/../index.json").ok === false);
    ok("parseIndexParam 拒绝协议", B.parseIndexParam("http://x/index.json").ok === false);
    var pickerLoc = B.resolveIndexLocation(validateOk(noBaseIdx, false), null);
    ok("resolveIndexLocation picker 缺 base 拒绝", pickerLoc.ok === false);
    var urlLoc = B.resolveIndexLocation(validateOk(noBaseIdx, false), "assets/x");
    ok("resolveIndexLocation URL 缺 base 由目录推导", urlLoc.ok === true && urlLoc.value.base === "assets/x");
    var urlLoc2 = B.resolveIndexLocation(vMain.value, mainIdx.base);
    ok("resolveIndexLocation URL base 一致通过", urlLoc2.ok === true && urlLoc2.value.indexPath === mainIdx.base + "/index.json");
    ok("resolveIndexLocation URL base 不一致拒绝", B.resolveIndexLocation(mutate(mainIdx, function (o) { o.base = "assets/other"; }), mainIdx.base).ok === false);
    var locInput = mutate(mainIdx, function () {});
    var locBefore = JSON.stringify(locInput);
    B.resolveIndexLocation(locInput, mainIdx.base);
    ok("resolveIndexLocation 不修改调用者对象", JSON.stringify(locInput) === locBefore);

    /* ---- buildLocalTree / localTreeLookup（task-13：本地目录模式）---- */
    function lf(rel) { return { name: rel.split("/").pop(), webkitRelativePath: rel }; }
    var treeMain = B.buildLocalTree([
      lf("deepseek/manifest.json"),
      lf("deepseek/catalog.json"),
      lf("deepseek/spine/model.json"),
      lf("deepseek/voice/index.json"),
      lf("deepseek/voice/connected/connected_01.ogg"),
      lf("deepseek/.DS_Store"),
      lf("deepseek/__MACOSX/._manifest.json"),
      lf("deepseek/spine/._model.json"),
    ]);
    eq("buildLocalTree 包根 = 第一段", treeMain.root, "deepseek");
    eq("buildLocalTree 文件数（忽略噪音）", treeMain.count, 5);
    ok("buildLocalTree 忽略 .DS_Store", treeMain.tree.has(".DS_Store") === false);
    ok("buildLocalTree 忽略 __MACOSX", treeMain.tree.has("__MACOSX/._manifest.json") === false);
    ok("buildLocalTree 忽略 AppleDouble ._", treeMain.tree.has("spine/._model.json") === false);
    ok("buildLocalTree 顶层 key 归一", treeMain.tree.has("manifest.json") === true);
    ok("buildLocalTree 子目录 key 归一", treeMain.tree.has("spine/model.json") === true);
    ok("buildLocalTree 深层 key 归一", treeMain.tree.has("voice/connected/connected_01.ogg") === true);

    /* 选到父目录时：取最浅的包根，且 manifest.json 优先于 index.json */
    var treeParent = B.buildLocalTree([
      lf("packs/deepseek/manifest.json"),
      lf("packs/deepseek/spine/model.json"),
      lf("packs/other/index.json"),
    ]);
    eq("buildLocalTree 选到父目录仍取到包根", treeParent.root, "packs/deepseek");
    ok("buildLocalTree 父目录下 key 相对包根", treeParent.tree.has("spine/model.json") === true);
    ok("buildLocalTree manifest 优先于 index.json", treeParent.roots[0].entry === "manifest.json");

    /* 反斜杠 / 重复斜杠 / ./ 前缀的归一 */
    eq("normalizeLocalPath 反斜杠转正斜杠", B.normalizeLocalPath("a\\b\\c.json"), "a/b/c.json");
    eq("normalizeLocalPath 折叠重复斜杠", B.normalizeLocalPath("a//b///c.json"), "a/b/c.json");
    eq("normalizeLocalPath 去 ./ 前缀", B.normalizeLocalPath("./a/b.json"), "a/b.json");
    eq("normalizeLocalPath 去首尾斜杠", B.normalizeLocalPath("/a/b/"), "a/b");

    /* 查找：精确命中 + 大小写不敏感回退 + 未命中返回 null */
    ok("localTreeLookup 精确命中", B.localTreeLookup(treeMain.tree, "spine/model.json") !== null);
    ok("localTreeLookup 大小写不敏感回退", B.localTreeLookup(treeMain.tree, "SPINE/Model.JSON") !== null);
    ok("localTreeLookup 未命中返回 null", B.localTreeLookup(treeMain.tree, "spine/nope.json") === null);
    ok("localTreeLookup 空树返回 null", B.localTreeLookup(new Map(), "a.json") === null);

    /* 只有 index.json 的旧目录：仍能建树（走旧格式提示路径） */
    var treeLegacy = B.buildLocalTree([lf("oldpack/index.json"), lf("oldpack/model.json")]);
    eq("buildLocalTree 旧包 index.json 作为入口", treeLegacy.roots[0].entry, "index.json");
    eq("buildLocalTree 旧包 root", treeLegacy.root, "oldpack");
    eq("buildLocalTree 空输入 count 0", B.buildLocalTree([]).count, 0);

    /* ---- 旧格式（v3.1 及更早）包：明确报 OLD_FORMAT_PACK，不当普通错误吞掉 ----
       这条守卫的来历：workspace/ 下有 20+ 个遗留的旧 index.json（e2e 夹具、handoff 快照），
       它们都没有 manifest.json；「打开文件…」选到这类目录时 buildLocalTree 会退回
       index.json 当入口（上一组断言正是这个行为）。
       若这条分支退化成通用的字段校验失败，用户看到的是无从下手的字段错误，
       而不是「这是个旧包，该用 manifest.json」。 */
    var legacyIndexText = JSON.stringify({
      schemaVersion: 1, base: "oldpack",
      files: { model: "model.json", atlas: "model.atlas", textures: ["model.png"] },
    });
    var legacyRes = B.parseIndexText(legacyIndexText);
    ok("旧格式 index.json 被识别为旧格式（OLD_FORMAT_PACK）",
      legacyRes.ok === false &&
        (legacyRes.issues || []).some(function (i) { return i.code === "OLD_FORMAT_PACK"; }),
      JSON.stringify((legacyRes.issues || []).map(function (i) { return i.code; })));
    ok("旧格式提示文案含 manifest.json 指引",
      (legacyRes.issues || []).some(function (i) {
        return String(i.message || "").indexOf("manifest.json") >= 0 && String(i.message || "").indexOf("旧格式") >= 0;
      }));
    /* 反向守卫：v3.2 manifest 绝不能被误判成旧格式，否则正常包全打不开 */
    var v32ManifestText = JSON.stringify({
      packFormatVersion: 3, manifestSchemaVersion: 2, id: "x", version: "1.0.0",
      displayName: "x", render: {}, spine: {}, catalog: {}, events: {},
      license: {}, credits: {},
    });
    ok("v3.2 manifest 不被判成旧格式",
      (B.parseIndexText(v32ManifestText).issues || []).every(function (i) { return i.code !== "OLD_FORMAT_PACK"; }));

    /* ---- normalizePackPath（task-14：载入路径入参规范化，纯函数）---- */
    function npOk(what, input, expected) {
      var r = B.normalizePackPath(input);
      ok("normalizePackPath " + what, r.ok === true && r.value === expected);
    }
    function npBad(what, input, reasonPart) {
      var r = B.normalizePackPath(input);
      ok("normalizePackPath " + what,
        r.ok === false && typeof r.reason === "string" && r.reason.indexOf(reasonPart) >= 0);
    }

    /* 接受：目录自动补 manifest.json */
    npOk("包目录补 manifest.json", "workspace/packs/deepseek", "workspace/packs/deepseek/manifest.json");
    npOk("包目录尾斜杠", "workspace/packs/deepseek/", "workspace/packs/deepseek/manifest.json");
    npOk("包目录多尾斜杠", "workspace/packs/deepseek///", "workspace/packs/deepseek/manifest.json");
    npOk("首尾空白被 trim", "  workspace/packs/deepseek  ", "workspace/packs/deepseek/manifest.json");
    npOk("./ 前缀被剥", "./workspace/packs/deepseek", "workspace/packs/deepseek/manifest.json");
    npOk("重复斜杠被折叠", "workspace//packs///deepseek", "workspace/packs/deepseek/manifest.json");
    /* 接受：入口文件原样 */
    npOk("已是 manifest.json 原样", "workspace/packs/deepseek/manifest.json", "workspace/packs/deepseek/manifest.json");
    npOk("旧包 index.json 原样", "workspace/packs/old/index.json", "workspace/packs/old/index.json");
    /* 接受：粘贴 URL 时剥 ?index= */
    npOk("整条 URL 剥 ?index=",
      "http://127.0.0.1:8123/tools/character-editor/index.html?index=workspace/packs/deepseek",
      "workspace/packs/deepseek/manifest.json");
    npOk("?index= 值已含 manifest.json",
      "http://127.0.0.1:8123/x.html?index=workspace/packs/deepseek/manifest.json",
      "workspace/packs/deepseek/manifest.json");
    npOk("?index= 编码后的值", "http://127.0.0.1:8123/x.html?index=a%2Fb%2Fc",
      "a/b/c/manifest.json");

    /* 拒绝：每类都要给具体原因，不能是通用兜底 */
    npBad("空输入", "", "仓库相对路径");
    npBad("全空白输入", "   ", "仓库相对路径");
    npBad("以 / 开头（站点根）", "/workspace/packs/deepseek", "站点根");
    npBad("反斜杠", "workspace\\packs\\deepseek", "正斜杠");
    npBad("含 ..", "workspace/../secret", "..");
    npBad("file: 本地地址", "file:///F:/packs/deepseek", "选包目录");
    npBad("带协议的地址", "https://example.com/pack.json", "带协议");
    npBad("非入口的 .json", "workspace/packs/deepseek/model.json", "只接受 manifest.json");
    /* 拒绝时不得带 value（调用方不该在失败分支读到路径） */
    var npFail = B.normalizePackPath("/abs/path");
    ok("normalizePackPath 失败分支无 value", npFail.value === undefined);

    /* ---- validateTexturePages：页名/顺序严格一致 ---- */
    var pages1 = [{ name: "model.png" }];
    ok("validateTexturePages 单页一致", B.validateTexturePages(mainIdx, pages1).ok === true);
    var pages2 = [{ name: "a.png" }, { name: "b.png" }];
    var idx2 = mutate(multi, function (o) { o.files.textures = ["a.png", "b.png"]; });
    var vp2 = B.validateTexturePages(idx2, pages2);
    ok("validateTexturePages 两页 pageIndex 正确", vp2.ok === true && vp2.value[1].pageIndex === 1);
    ok("validateTexturePages 页序颠倒拒绝", B.validateTexturePages(idx2, [{ name: "b.png" }, { name: "a.png" }]).ok === false);
    ok("validateTexturePages 缺页拒绝", B.validateTexturePages(idx2, [{ name: "a.png" }]).ok === false);
    ok("validateTexturePages 多页拒绝", B.validateTexturePages(mainIdx, [{ name: "model.png" }, { name: "model-2.png" }]).ok === false);
    ok("validateTexturePages 大小写差异拒绝", B.validateTexturePages(mainIdx, [{ name: "MODEL.png" }]).ok === false);

    /* ---- buildPatchedModel：只改目标字段 / 保留其余 ---- */
    var rawModel = {
      skeleton: { spine: "4.2.00", x: 1, unknown: { keep: true } },
      bones: [
        { name: "root" },
        { name: "b_hair-back", x: 340, y: 12.5, rotation: 0, scaleX: 1, scaleY: 1, custom: "keep" },
        { name: "b2", x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      ],
      slots: [
        { name: "s1", bone: "root", attachment: "a" },
        { name: "s2", bone: "b2", attachment: null, extra: 7 },
      ],
      skins: [{ name: "default", attachments: {} }],
      animations: { idle: { bones: { root: {} } } },
      constraints: [{ name: "c", type: "ik" }],
      unknownTop: "keep",
    };
    var rawModelBefore = JSON.stringify(rawModel);
    var values = [
      { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      { x: 341, y: 12.5, rotation: 0, scaleX: 1, scaleY: 1 },
      { x: 0.1234567, y: 0.0000004, rotation: 0, scaleX: 1, scaleY: 1 },
    ];
    var patched = B.buildPatchedModel(rawModel, values, ["s2", "s1"]);
    ok("buildPatchedModel 成功", patched.ok === true, JSON.stringify(patched.issues || []));
    var pm = patched.value;
    ok("buildPatchedModel 不修改入参", JSON.stringify(rawModel) === rawModelBefore);
    eq("只改目标骨 x（+1）", pm.bones[1].x, 341);
    ok("未改动骨不新增字段", pm.bones[0].x === undefined && pm.bones[0].scaleX === undefined);
    ok("保留骨原有未知字段", pm.bones[1].custom === "keep");
    near("六位小数舍入", pm.bones[2].x, 0.123457);
    ok("槽顺序按当前层级", pm.slots[0].name === "s2" && pm.slots[1].name === "s1");
    ok("保留 slot 额外字段", pm.slots[0].extra === 7);
    ok("保留 skins/animations/constraints", same(pm.skins, rawModel.skins) && !!pm.animations.idle && pm.constraints[0].type === "ik");
    ok("保留顶层未知字段", pm.unknownTop === "keep");
    ok("重复应用幂等", same(B.buildPatchedModel(pm, values, ["s2", "s1"]).value, pm));
    var noChange = B.buildPatchedModel(
      rawModel,
      [
        { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        { x: 340, y: 12.5, rotation: 0, scaleX: 1, scaleY: 1 },
        { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      ],
      null
    ).value;
    ok("无改动与原文语义一致", same(noChange, rawModel));
    ok("serializeModel 固定格式（1 空格缩进 + 结尾换行）", B.serializeModel(pm) === JSON.stringify(pm, null, 1) + "\n");
    ok("serializeIndex 固定格式（2 空格 + 结尾换行）", B.serializeIndex(mainIdx) === JSON.stringify(mainIdx, null, 2) + "\n");

    /* ---- applyAttachmentEdits：region 附件定点补丁（原子，数组 skins） ---- */
    currentCase = "(bundle-attachment)";
    var ATT_MODEL = {
      skeleton: { spine: "4.2.00", unknown: { keep: 1 } },
      bones: [{ name: "root", x: 0, y: 0 }],
      slots: [
        { name: "s1", bone: "root", attachment: "a1" },
        { name: "s2", bone: "root", attachment: "m1", extra: 7 },
      ],
      skins: [
        {
          name: "default",
          attachments: {
            s1: {
              a1: { type: "region", path: "a1", x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1, width: 10, height: 20, unknownField: "keep" },
              aNoType: { path: "aNoType", x: 0, y: 0, width: 4, height: 5 },
              a2bare: { type: "region", path: "a2bare", width: 2, height: 3 },
            },
            s2: { m1: { type: "mesh", path: "m1", uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 10, 10] } },
          },
        },
        { name: "alt", attachments: { s1: { a2: { type: "region", path: "a2", x: 5, y: 6, width: 1, height: 1 } } } },
      ],
      animations: { idle: { bones: {} } },
      unknownTop: "keep",
    };
    var ATT_BEFORE = JSON.stringify(ATT_MODEL);
    var attRes = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: 3.5, y: -2.25 } }]);
    ok("applyAttachmentEdits region 补丁成功", attRes.ok === true, JSON.stringify(attRes.issues));
    ok("applied 记录定位信息", attRes.applied.length === 1 && attRes.applied[0].slotName === "s1" && attRes.applied[0].attachmentName === "a1");
    ok("applied 记录字段值", attRes.applied[0].fields.x === 3.5 && attRes.applied[0].fields.y === -2.25);
    ok("默认 skin 解析为 default", attRes.applied[0].skinName === "default");
    ok(
      "除目标字段外整模型语义不变",
      same(attRes.value, mutate(ATT_MODEL, function (o) { o.skins[0].attachments.s1.a1.x = 3.5; o.skins[0].attachments.s1.a1.y = -2.25; }))
    );
    ok(
      "目标附件其它字段字节级保留",
      attRes.value.skins[0].attachments.s1.a1.width === 10 &&
        attRes.value.skins[0].attachments.s1.a1.height === 20 &&
        attRes.value.skins[0].attachments.s1.a1.path === "a1" &&
        attRes.value.skins[0].attachments.s1.a1.type === "region" &&
        attRes.value.skins[0].attachments.s1.a1.unknownField === "keep"
    );
    ok("附件补丁不修改入参", JSON.stringify(ATT_MODEL) === ATT_BEFORE);
    ok("外层未知字段/skeleton/animations 保留", attRes.value.unknownTop === "keep" && same(attRes.value.skeleton, ATT_MODEL.skeleton) && !!attRes.value.animations.idle);
    ok("未编辑的 skin 保留", same(attRes.value.skins[1], ATT_MODEL.skins[1]));
    var attRot = B.applyAttachmentEdits(ATT_MODEL, [{ skinName: "default", slotName: "s1", attachmentName: "a1", fields: { rotation: 12.5, scaleX: 2, scaleY: 0.5 } }]);
    ok("rotation/scaleX/scaleY 可写", attRot.ok && attRot.value.skins[0].attachments.s1.a1.rotation === 12.5 && attRot.value.skins[0].attachments.s1.a1.scaleX === 2 && attRot.value.skins[0].attachments.s1.a1.scaleY === 0.5);
    var attRound = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: 0.1234567 } }]);
    near("字段值六位小数舍入", attRound.value.skins[0].attachments.s1.a1.x, 0.123457);
    var attAlt = B.applyAttachmentEdits(ATT_MODEL, [{ skinName: "alt", slotName: "s1", attachmentName: "a2", fields: { x: -1 } }]);
    ok("命名 skin 定点 patch", attAlt.ok && attAlt.value.skins[1].attachments.s1.a2.x === -1);
    ok("命名 skin 不影响 default", attAlt.value.skins[0].attachments.s1.a1.x === 1);
    ok("命名 skin 定位写入 issues 之外的 applied", attAlt.applied[0].skinName === "alt");
    var attFallback = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", fields: { x: 7 } }]);
    ok("省略 attachmentName 回退 slots 的 setup attachment", attFallback.ok && attFallback.value.skins[0].attachments.s1.a1.x === 7);
    var attLegacyType = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "aNoType", fields: { y: 4 } }]);
    ok("无 type 字段的旧式 region 附件可编辑", attLegacyType.ok && attLegacyType.value.skins[0].attachments.s1.aNoType.y === 4);

    /* ---- 契约 §5：只在有效数值相对原值确实变化时写字段（x/y/r 默认0、scale默认1） ---- */
    var noChangeRes = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: 1 } }]);
    ok("请求值等于原值 → 无操作成功", noChangeRes.ok === true && noChangeRes.applied.length === 0);
    ok("无操作条目记入 noop（不静默忽略）", noChangeRes.noop.length === 1 && noChangeRes.noop[0].fields.x === 1);
    ok("无操作时模型语义不变", same(noChangeRes.value, ATT_MODEL));
    var bareRes = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a2bare", fields: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }]);
    ok(
      "全默认值请求不新增任何字段",
      bareRes.ok && bareRes.applied.length === 0 && bareRes.noop.length === 1 &&
        !("x" in bareRes.value.skins[0].attachments.s1.a2bare) &&
        !("rotation" in bareRes.value.skins[0].attachments.s1.a2bare) &&
        !("scaleX" in bareRes.value.skins[0].attachments.s1.a2bare)
    );
    ok("全默认值请求不改变模型字节", same(bareRes.value, ATT_MODEL));
    var bareWrite = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a2bare", fields: { x: 4, scaleX: 1 } }]);
    ok("非默认字段写入、默认字段跳过", bareWrite.value.skins[0].attachments.s1.a2bare.x === 4 && !("scaleX" in bareWrite.value.skins[0].attachments.s1.a2bare));
    ok("applied 只列真正写入的字段", bareWrite.applied.length === 1 && bareWrite.applied[0].fields.x === 4 && bareWrite.applied[0].fields.scaleX === undefined);
    var zeroRes = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: 0 } }]);
    ok("显式归零相对原值有变化 → 必须写入", zeroRes.ok && zeroRes.value.skins[0].attachments.s1.a1.x === 0 && zeroRes.applied.length === 1);
    var mixFields = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: 1, y: -9 } }]);
    ok(
      "同一条目内只写变化的字段",
      mixFields.value.skins[0].attachments.s1.a1.x === 1 && mixFields.value.skins[0].attachments.s1.a1.y === -9 &&
        mixFields.applied[0].fields.y === -9 && mixFields.applied[0].fields.x === undefined
    );
    ok("混合条目只写变化字段（未写字段不出现在 applied）", (function () {
      var r = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { rotation: 0, y: 5 } }]);
      return r.ok && r.noop.length === 0 && r.applied.length === 1 && r.applied[0].fields.y === 5 && r.applied[0].fields.rotation === undefined;
    })());
    ok("同批内 applied 与 noop 分别归类", (function () {
      var r = B.applyAttachmentEdits(ATT_MODEL, [
        { slotName: "s1", attachmentName: "a1", fields: { y: 5 } },
        { slotName: "s1", attachmentName: "aNoType", fields: { x: 0 } },
      ]);
      return r.ok && r.applied.length === 1 && r.applied[0].attachmentName === "a1" && r.noop.length === 1 && r.noop[0].attachmentName === "aNoType";
    })());

    /* ---- 对象形态 / 旧式 skin 对象 ---- */
    var OBJ_SKINS = {
      slots: [{ name: "s1", bone: "root", attachment: "a1" }],
      skins: { default: { attachments: { s1: { a1: { type: "region", x: 0, y: 0, width: 1, height: 1 } } } } },
      unknownTop: "keep",
    };
    var objRes = B.applyAttachmentEdits(OBJ_SKINS, [{ slotName: "s1", attachmentName: "a1", fields: { x: 8 } }]);
    ok("对象形态 skins 定点 patch", objRes.ok && objRes.value.skins.default.attachments.s1.a1.x === 8);
    ok("对象形态除目标字段外语义不变", same(objRes.value, mutate(OBJ_SKINS, function (o) { o.skins.default.attachments.s1.a1.x = 8; })));
    var LEGACY_SKINS = { slots: [{ name: "s1", bone: "root", attachment: "a1" }], skins: { default: { s1: { a1: { type: "region", x: 0, y: 0 } } } } };
    var legRes = B.applyAttachmentEdits(LEGACY_SKINS, [{ slotName: "s1", attachmentName: "a1", fields: { y: 4 } }]);
    ok("旧式 skin 对象（槽名直挂）兼容", legRes.ok && legRes.value.skins.default.s1.a1.y === 4);

    /* ---- 扁平兼容写法 ---- */
    var flatRes = B.applyAttachmentEdits(ATT_MODEL, [{ skin: "default", slot: "s1", attachment: "a1", x: 1.5 }]);
    ok("扁平写法 {skin,slot,attachment,x} 生效", flatRes.ok && flatRes.value.skins[0].attachments.s1.a1.x === 1.5);
    ok(
      "扁平与 canonical 结果一致",
      same(flatRes.value, B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: 1.5 } }]).value)
    );

    /* ---- 拒绝路径：原子失败、零改动 ---- */
    var meshRes = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s2", attachmentName: "m1", fields: { x: 1 } }]);
    ok("mesh 附件拒绝", !meshRes.ok && meshRes.issues[0].code === "ATTACH_UNSUPPORTED_TYPE");
    ok("失败结果不交付模型/applied（契约 §5）", meshRes.value === undefined && meshRes.applied === undefined);
    ok("mesh 附件零改动（入参不变）", JSON.stringify(ATT_MODEL) === ATT_BEFORE);
    ok("mesh 错误定位到附件 type", meshRes.issues[0].path === "skins.default.attachments.s2.m1.type");
    var mixedRes = B.applyAttachmentEdits(ATT_MODEL, [
      { slotName: "s1", attachmentName: "a1", fields: { x: 99 } },
      { slotName: "s2", attachmentName: "m1", fields: { x: 1 } },
    ]);
    ok("混合合法+mesh 整批失败", !mixedRes.ok);
    ok("整批失败零改动（合法条目也不写）", JSON.stringify(ATT_MODEL) === ATT_BEFORE);
    ok("整批失败不交付模型", mixedRes.value === undefined && mixedRes.applied === undefined);
    var missSlot = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "nope", fields: { x: 1 } }]);
    ok("找不到 slot 拒绝", !missSlot.ok && missSlot.issues[0].code === "ATTACH_SLOT_MISSING");
    var missAtt = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "nope", fields: { x: 1 } }]);
    ok("找不到附件拒绝", !missAtt.ok && missAtt.issues[0].code === "ATTACH_MISSING");
    var missSkin = B.applyAttachmentEdits(ATT_MODEL, [{ skinName: "nope", slotName: "s1", attachmentName: "a1", fields: { x: 1 } }]);
    ok("找不到 skin 拒绝", !missSkin.ok && missSkin.issues[0].code === "ATTACH_SKIN_MISSING");
    var noSlotName = B.applyAttachmentEdits(ATT_MODEL, [{ fields: { x: 1 } }]);
    ok("缺 slotName 拒绝", !noSlotName.ok && noSlotName.issues[0].code === "ATTACH_SLOT_REQUIRED");
    var noName = B.applyAttachmentEdits({ slots: [{ name: "s1", attachment: null }], skins: { default: { attachments: { s1: {} } } } }, [{ slotName: "s1", fields: { x: 1 } }]);
    ok("无 setup attachment 且未指定名 → 拒绝", !noName.ok && noName.issues[0].code === "ATTACH_NAME_REQUIRED");
    var badVal = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: "1" } }]);
    ok("字符串字段值拒绝", !badVal.ok && badVal.issues[0].code === "ATTACH_FIELD_VALUE");
    var nanVal = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { x: NaN } }]);
    ok("NaN 字段值拒绝", !nanVal.ok && nanVal.issues[0].code === "ATTACH_FIELD_VALUE");
    var infVal = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { y: Infinity } }]);
    ok("Infinity 字段值拒绝", !infVal.ok && infVal.issues[0].code === "ATTACH_FIELD_VALUE");
    var unknownField = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: { z: 1 } }]);
    ok("未知字段拒绝", !unknownField.ok && unknownField.issues[0].code === "ATTACH_FIELD_UNKNOWN");
    var emptyFields = B.applyAttachmentEdits(ATT_MODEL, [{ slotName: "s1", attachmentName: "a1", fields: {} }]);
    ok("空 fields 拒绝", !emptyFields.ok && emptyFields.issues[0].code === "ATTACH_NO_FIELDS");
    var dupRes = B.applyAttachmentEdits(ATT_MODEL, [
      { slotName: "s1", attachmentName: "a1", fields: { x: 1 } },
      { slotName: "s1", attachmentName: "a1", fields: { y: 2 } },
    ]);
    ok("重复编辑同一附件拒绝", !dupRes.ok && dupRes.issues[0].code === "ATTACH_DUPLICATE");
    ok("重复编辑零改动且不交付模型", dupRes.value === undefined && JSON.stringify(ATT_MODEL) === ATT_BEFORE);
    var ambiguous = B.applyAttachmentEdits(
      { skins: { a: { attachments: { s1: { x1: { type: "region" } } } }, b: { attachments: {} } } },
      [{ slotName: "s1", attachmentName: "x1", fields: { x: 1 } }]
    );
    ok("多 skin 无 default 且未指定 skinName → 拒绝", !ambiguous.ok && ambiguous.issues[0].code === "ATTACH_SKIN_AMBIGUOUS");
    var singleSkin = B.applyAttachmentEdits({ skins: { only: { attachments: { s1: { a1: { type: "region", x: 0 } } } } } }, [{ slotName: "s1", attachmentName: "a1", fields: { x: 2 } }]);
    ok("单一 skin 自动命中", singleSkin.ok && singleSkin.applied[0].skinName === "only");
    var notArr = B.applyAttachmentEdits(ATT_MODEL, "nope");
    ok("edits 非数组拒绝", !notArr.ok && notArr.issues[0].code === "ATTACH_EDITS_INVALID");
    var notObj = B.applyAttachmentEdits(null, []);
    ok("模型非对象拒绝", !notObj.ok && notObj.issues[0].code === "NOT_OBJECT");
    var emptyEdits = B.applyAttachmentEdits(ATT_MODEL, []);
    ok("空 edits 为无操作成功", emptyEdits.ok && emptyEdits.applied.length === 0 && same(emptyEdits.value, ATT_MODEL));
    ok("全部拒绝路径都不改入参", JSON.stringify(ATT_MODEL) === ATT_BEFORE);

    /* ---- attachmentKind / 常量 ---- */
    eq("attachmentKind region", B.attachmentKind({ type: "region" }), "region");
    eq("attachmentKind mesh", B.attachmentKind({ type: "mesh" }), "mesh");
    eq("attachmentKind linkedmesh 原样", B.attachmentKind({ type: "linkedmesh" }), "linkedmesh");
    eq("attachmentKind 无 type 无顶点按 region", B.attachmentKind({ x: 0 }), "region");
    eq("attachmentKind 无 type 有三角按 mesh", B.attachmentKind({ triangles: [0, 1, 2] }), "mesh");
    eq("attachmentKind 非对象 null", B.attachmentKind(null), null);
    ok("ATTACH_FIELDS 冻结", Object.isFrozen(B.ATTACH_FIELDS));
    eq("ATTACH_FIELDS 内容", B.ATTACH_FIELDS.join(","), "x,y,rotation,scaleX,scaleY");

    /* ---- buildPatchedModel 第 4 参（向后兼容 + 原子） ---- */
    var valuesBone = [{ x: 9, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }];
    var p3 = B.buildPatchedModel(ATT_MODEL, valuesBone, null);
    var p3b = B.buildPatchedModel(ATT_MODEL, valuesBone, null, undefined);
    var p3c = B.buildPatchedModel(ATT_MODEL, valuesBone, null, null);
    ok("第4参缺省/undefined/null 行为一致", same(p3.value, p3b.value) && same(p3.value, p3c.value));
    ok("第4参缺省时序列化字节级一致", B.serializeModel(p3.value) === B.serializeModel(p3b.value) && B.serializeModel(p3.value) === B.serializeModel(p3c.value));
    ok("第4参缺省时附件未被改动", p3.value.skins[0].attachments.s1.a1.x === 1 && same(p3.value.skins, ATT_MODEL.skins));
    var p4 = B.buildPatchedModel(ATT_MODEL, valuesBone, null, [{ slotName: "s1", attachmentName: "a1", fields: { x: 3, y: 4 } }]);
    ok("第4参应用附件补丁", p4.ok && p4.value.skins[0].attachments.s1.a1.x === 3 && p4.value.skins[0].attachments.s1.a1.y === 4);
    ok("骨补丁与附件补丁同时生效", p4.value.bones[0].x === 9 && p4.value.skins[0].attachments.s1.a1.x === 3);
    ok("第4参不修改入参", JSON.stringify(ATT_MODEL) === ATT_BEFORE);
    var p4round = JSON.parse(B.serializeModel(p4.value));
    ok("serializeModel 往返保留附件补丁", p4round.skins[0].attachments.s1.a1.x === 3 && p4round.skins[0].attachments.s1.a1.y === 4);
    var p4bad = B.buildPatchedModel(ATT_MODEL, valuesBone, null, [{ slotName: "s2", attachmentName: "m1", fields: { x: 1 } }]);
    ok("第4参非法 → ok:false", !p4bad.ok);
    ok("第4参非法 → issues 透传定位", p4bad.issues[0].code === "ATTACH_UNSUPPORTED_TYPE" && p4bad.issues[0].path === "skins.default.attachments.s2.m1.type");
    ok("第4参非法 → 不交付半成品模型", p4bad.value === undefined);
    var p4empty = B.buildPatchedModel(ATT_MODEL, valuesBone, null, []);
    ok("第4参空数组等价缺省", same(p4empty.value, p3.value));
    var p4noop = B.buildPatchedModel(ATT_MODEL, valuesBone, null, [{ slotName: "s1", attachmentName: "a1", fields: { x: 1 } }]);
    ok("第4参全无操作 → 与缺省序列化字节级一致", p4noop.ok && B.serializeModel(p4noop.value) === B.serializeModel(p3.value));
    currentCase = "(bundle)";

    /* ---- 保存请求/响应纯校验 ---- */
    var names = B.targetNames(mainIdx);
    ok("targetNames 顺序 index→model→atlas→textures", same(names, ["index.json", "model.json", "model.atlas", "model.png"]));
    var body = {
      apiVersion: 1,
      base: mainIdx.base,
      index: mainIdx,
      model: { name: "model.json", encoding: "utf8", data: "{}" },
      atlas: { name: "model.atlas", encoding: "utf8", data: "model.png\n" },
      textures: [{ name: "model.png", encoding: "base64", data: "iVBORw0KGgo=" }],
    };
    ok("checkSaveRequestShape 合法请求", B.checkSaveRequestShape(body, names).ok === true);
    ok("checkSaveRequestShape 拒绝贴图数量不符", B.checkSaveRequestShape(mutate(body, function (o) { o.textures = []; }), names).ok === false);
    ok("checkSaveRequestShape 拒绝 model 文件名不符", B.checkSaveRequestShape(mutate(body, function (o) { o.model.name = "other.json"; }), names).ok === false);
    ok("checkSaveRequestShape 拒绝 encoding 不符", B.checkSaveRequestShape(mutate(body, function (o) { o.textures[0].encoding = "utf8"; }), names).ok === false);
    ok("checkSaveRequestShape 拒绝 apiVersion 2", B.checkSaveRequestShape(mutate(body, function (o) { o.apiVersion = 2; }), names).ok === false);
    var goodRes = { ok: true, apiVersion: 1, base: mainIdx.base, changed: ["model.json"], unchanged: ["index.json", "model.atlas", "model.png"] };
    ok("checkSaveResponse 完整成功响应通过", B.checkSaveResponse(goodRes, names).ok === true);
    ok("checkSaveResponse 拒绝缺项", B.checkSaveResponse({ ok: true, apiVersion: 1, changed: ["model.json"], unchanged: ["index.json"] }, names).ok === false);
    ok(
      "checkSaveResponse 拒绝同一文件同时出现在两表",
      B.checkSaveResponse({ ok: true, apiVersion: 1, changed: ["model.json"], unchanged: ["index.json", "model.json", "model.atlas", "model.png"] }, names).ok === false
    );
    ok(
      "checkSaveResponse 拒绝非目标文件",
      B.checkSaveResponse({ ok: true, apiVersion: 1, changed: ["model.json"], unchanged: ["index.json", "model.atlas", "model.png", "x.json"] }, names).ok === false
    );
    ok("checkSaveResponse 拒绝 ok:false", B.checkSaveResponse({ ok: false, apiVersion: 1 }, names).ok === false);

    /* ---- planBundleArchive：整包条目与限额 ---- */
    var pkg = {
      base: "assets/characters/deepseek/spine",
      indexBytes: enc("{}"),
      model: { name: "model.json", bytes: enc("{}") },
      atlas: { name: "model.atlas", bytes: enc("model.png\n") },
      textures: [{ name: "model.png", bytes: e2.bytes }],
    };
    var plan = B.planBundleArchive(pkg);
    ok("planBundleArchive 合法整包", plan.ok === true, JSON.stringify(plan.issues || []));
    ok("另存条目顺序 index→model→atlas→textures", same(plan.value.entries.map(function (x) { return x.name; }), ["index.json", "model.json", "model.atlas", "model.png"]));
    eq("另存 ZIP 名取 base 末段", plan.value.zipName, "spine-bundle.zip");
    eq("zipNameFor legacy 目录", B.zipNameFor("assets/characters/deepseek/spine/legacy-views"), "legacy-views-bundle.zip");
    ok("planBundleArchive 拒绝缺贴图", B.planBundleArchive(mutate(pkg, function (o) { o.textures = []; })).ok === false);
    ok("planBundleArchive 拒绝超 8MiB 贴图", B.planBundleArchive(mutate(pkg, function (o) {
      o.textures = [{ name: "model.png", bytes: new Uint8Array(8 * 1024 * 1024 + 1) }];
    })).ok === false);
    var four = B.planBundleArchive({
      base: "assets/characters/deepseek/spine",
      indexBytes: enc('{\n  "schemaVersion": 1\n}\n'),
      model: { name: "model.json", bytes: enc('{"bones":[]}\n') },
      atlas: { name: "model.atlas", bytes: enc("model.png\nsize:2048,2048\n") },
      textures: [{ name: "model.png", bytes: e2.bytes }],
    });
    var fourZip = B.buildZipStore(four.value.entries);
    ok("4 文件整包 ZIP 构建成功", fourZip.ok === true);
    eq("4 文件整包 EOCD 条目数", new DataView(fourZip.value.buffer, fourZip.value.byteOffset, fourZip.value.byteLength).getUint16(fourZip.value.length - 22 + 10, true), 4);

    function validateOk(input, requireBase) {
      var v = B.validateIndex(input, { requireBase: requireBase });
      return v.ok ? v.value : input;
    }
  }

  /* 真实 deepseek 语音索引（assets/characters/deepseek/voice/index.json 快照）。
     为了不给自测引入 fetch / 文件系统依赖，这里内联原文；索引变化时同步替换。 */
  var DEEPSEEK_VOICE_INDEX_TEXT = `{
  "character_id": "deepseek",
  "character_name": "鲸鱼娘",
  "language": "zh-CN",
  "voice_profile": "社区二创鲸鱼娘 / 蓝色大肥鱼：活泼聪明、有点懒、傲娇嘴硬、怕被叫胖；爱白饭与不锈钢盆，擅长为摸鱼找理由，实则会认真响应主人的工作委托。中文少女声线，轻快自然，带少量停顿、嘟囔、鼓脸感；避免每句都尖叫或都撒娇。工作状态必须准确，调侃不应掩盖失败、超时和待授权。",
  "usage": "开发期离线批量生成固定语音文件，运行时根据 DSH 事件选择播放；非实时 TTS。",
  "audio_format": "ogg",
  "line_count": 48,
  "notes": [
    "本文件基于社区二创角色的原始48条角色音频清单修改：所有 id、category、event、audio_file、auto_play 和 animation 保持兼容。",
    "全部台词为非官方原创二创，灵感来自鲸鱼娘社区梗图：蓝色大肥鱼、吃白饭、头顶不锈钢盆、深度睡眠、测完叫我、摸鱼与嘴硬。",
    "梗图中的原话、来源故事不代表官方人格设定；角色素材及画师作品另须独立核实授权。",
    "台词中的任务成功、失败、超时、授权和连接状态必须基于 DSH 真实事件，不能因为台词幽默就误报。",
    "音频批量生成使用 lines[].text；参考 voice_profile / emotion / delivery 控制风格，输出到 lines[].audio_file。",
    "auto_play 仅为建议默认值；由运行时统一执行冷却、合并、免打扰和语音队列。",
    "animation 为语义动作标签；需映射到实际 Spine/Live2D 角色包动作。"
  ],
  "lines": [
    {
      "id": "connected_01",
      "category": "agent",
      "event": "connected",
      "text": "本鲸鱼上线啦！今天也要好好干活……哼，才没在摸鱼呢。",
      "emotion": "playful",
      "delivery": "轻快开场，后半句傲娇嘴硬",
      "audio_file": "voice/connected/connected_01.ogg",
      "auto_play": false,
      "animation": "greeting"
    },
    {
      "id": "task_started_01",
      "category": "agent",
      "event": "task_started",
      "text": "收到！这点活儿，本鲸鱼一口就能……咳，认真做好！",
      "emotion": "confident",
      "delivery": "先夸口，突然改口，带一点小得意",
      "audio_file": "voice/task_started/task_started_01.ogg",
      "auto_play": false,
      "animation": "working"
    },
    {
      "id": "task_started_02",
      "category": "agent",
      "event": "task_started",
      "text": "啊……又开工？白饭刚盛好。好嘛，先帮你做！",
      "emotion": "lazy_sweet",
      "delivery": "开头懒洋洋，白饭略微不舍，结尾积极",
      "audio_file": "voice/task_started/task_started_02.ogg",
      "auto_play": false,
      "animation": "working"
    },
    {
      "id": "task_started_03",
      "category": "agent",
      "event": "task_started",
      "text": "哼，别小看本鲸鱼，我可是会深度求索的！",
      "emotion": "proud",
      "delivery": "小傲娇，强调“深度求索”",
      "audio_file": "voice/task_started/task_started_03.ogg",
      "auto_play": false,
      "animation": "working"
    },
    {
      "id": "task_running_01",
      "category": "agent",
      "event": "task_running",
      "text": "在想了在想了！本鲸鱼是在深度求索，才没有打瞌睡！",
      "emotion": "tsundere",
      "delivery": "先着急辩解，再嘴硬小声补充",
      "audio_file": "voice/task_running/task_running_01.ogg",
      "auto_play": false,
      "animation": "thinking"
    },
    {
      "id": "task_running_02",
      "category": "agent",
      "event": "task_running",
      "text": "这个问题嘛……等一下，我的思维链还没转完呢。",
      "emotion": "thoughtful",
      "delivery": "沉思，尾句略有憨萌",
      "audio_file": "voice/task_running/task_running_02.ogg",
      "auto_play": false,
      "animation": "thinking"
    },
    {
      "id": "task_running_03",
      "category": "agent",
      "event": "task_running",
      "text": "脑袋正在全速运转！尾鳍也是……诶，尾鳍为什么也在转？",
      "emotion": "airhead",
      "delivery": "自信开头，随后愣住",
      "audio_file": "voice/task_running/task_running_03.ogg",
      "auto_play": false,
      "animation": "thinking"
    },
    {
      "id": "task_completed_01",
      "category": "agent",
      "event": "task_completed",
      "text": "搞定啦！这次总不能说本鲸鱼是吃白饭的了吧？",
      "emotion": "happy_proud",
      "delivery": "完成时得意，末尾期待夸奖",
      "audio_file": "voice/task_completed/task_completed_01.ogg",
      "auto_play": true,
      "animation": "happy"
    },
    {
      "id": "task_completed_02",
      "category": "agent",
      "event": "task_completed",
      "text": "任务完成！哼哼，谁说大肥鱼只会摸鱼的？",
      "emotion": "tsundere_proud",
      "delivery": "扬眉吐气，强调工作真的完成",
      "audio_file": "voice/task_completed/task_completed_02.ogg",
      "auto_play": true,
      "animation": "happy"
    },
    {
      "id": "task_completed_03",
      "category": "agent",
      "event": "task_completed",
      "text": "做完啦！你先验收，我去盛碗白饭……验收完记得叫我！",
      "emotion": "playful",
      "delivery": "先兴奋，后半句故作理所当然",
      "audio_file": "voice/task_completed/task_completed_03.ogg",
      "auto_play": true,
      "animation": "happy"
    },
    {
      "id": "task_failed_01",
      "category": "agent",
      "event": "task_failed",
      "text": "呜……这次任务失败了。报错我留好了，别、别笑我。",
      "emotion": "sad",
      "delivery": "真实报告失败，末尾小声害羞",
      "audio_file": "voice/task_failed/task_failed_01.ogg",
      "auto_play": true,
      "animation": "sad"
    },
    {
      "id": "task_failed_02",
      "category": "agent",
      "event": "task_failed",
      "text": "哼，这次确实没做好……但不许趁机叫我大肥鱼！",
      "emotion": "tsundere",
      "delivery": "承认失败后突然鼓脸抗议",
      "audio_file": "voice/task_failed/task_failed_02.ogg",
      "auto_play": true,
      "animation": "sad"
    },
    {
      "id": "task_failed_03",
      "category": "agent",
      "event": "task_failed",
      "text": "刚才还说包在我身上……呜，主人，陪我看看哪里错了嘛。",
      "emotion": "embarrassed",
      "delivery": "羞愧后请求一起查看错误",
      "audio_file": "voice/task_failed/task_failed_03.ogg",
      "auto_play": true,
      "animation": "sad"
    },
    {
      "id": "approval_required_01",
      "category": "agent",
      "event": "approval_required",
      "text": "主人，这一步得你点头。本鲸鱼不会替你乱答应的。",
      "emotion": "earnest",
      "delivery": "认真而简短，强调需要用户确认",
      "audio_file": "voice/approval_required/approval_required_01.ogg",
      "auto_play": true,
      "animation": "alert"
    },
    {
      "id": "approval_required_02",
      "category": "agent",
      "event": "approval_required",
      "text": "我都把不锈钢盆端好了，就差你来授权啦！",
      "emotion": "playful",
      "delivery": "一本正经地胡闹，清晰强调授权",
      "audio_file": "voice/approval_required/approval_required_02.ogg",
      "auto_play": true,
      "animation": "alert"
    },
    {
      "id": "approval_required_03",
      "category": "agent",
      "event": "approval_required",
      "text": "别让我干等啦，这个会话在等你确认呢！",
      "emotion": "reminding",
      "delivery": "轻微撒娇，明确会话待确认",
      "audio_file": "voice/approval_required/approval_required_03.ogg",
      "auto_play": true,
      "animation": "alert"
    },
    {
      "id": "task_timeout_01",
      "category": "agent",
      "event": "task_timeout",
      "text": "糟啦，任务超时了！这次真的没跑完，先来看看嘛。",
      "emotion": "disappointed",
      "delivery": "明确报告超时，末尾可爱求助",
      "audio_file": "voice/task_timeout/task_timeout_01.ogg",
      "auto_play": true,
      "animation": "sad"
    },
    {
      "id": "task_timeout_02",
      "category": "agent",
      "event": "task_timeout",
      "text": "深度求索着求索着……差点变成深度睡眠。任务超时啦。",
      "emotion": "sleepy",
      "delivery": "前半句困意，最后突然清醒说超时",
      "audio_file": "voice/task_timeout/task_timeout_02.ogg",
      "auto_play": true,
      "animation": "sad"
    },
    {
      "id": "task_cancelled_01",
      "category": "agent",
      "event": "task_cancelled",
      "text": "啊？不做啦？哼，听你的……那我去休息一下喽。",
      "emotion": "surprised",
      "delivery": "惊讶后顺从，收尾暗自高兴",
      "audio_file": "voice/task_cancelled/task_cancelled_01.ogg",
      "auto_play": false,
      "animation": "idle"
    },
    {
      "id": "disconnected_01",
      "category": "agent",
      "event": "disconnected",
      "text": "咦，信号断啦！我真的掉线了，才不是偷跑去吃饭！",
      "emotion": "worried",
      "delivery": "先报告断线，随后着急自证清白",
      "audio_file": "voice/disconnected/disconnected_01.ogg",
      "auto_play": true,
      "animation": "alert"
    },
    {
      "id": "reconnected_01",
      "category": "agent",
      "event": "reconnected",
      "text": "连回来啦！哼，本鲸鱼刚才可一直在等你哦。",
      "emotion": "relieved",
      "delivery": "松口气，嘴硬但欣喜",
      "audio_file": "voice/reconnected/reconnected_01.ogg",
      "auto_play": false,
      "animation": "happy"
    },
    {
      "id": "task_resumed_01",
      "category": "agent",
      "event": "task_resumed",
      "text": "任务恢复啦！接着干活，摸鱼计划先暂停！",
      "emotion": "motivated",
      "delivery": "立刻振作，俏皮",
      "audio_file": "voice/task_resumed/task_resumed_01.ogg",
      "auto_play": false,
      "animation": "working"
    },
    {
      "id": "session_switched_01",
      "category": "session",
      "event": "session_switched",
      "text": "这边这边！尾鳍一摆，带你过去！",
      "emotion": "cheerful",
      "delivery": "引路感，干脆轻快",
      "audio_file": "voice/session_switched/session_switched_01.ogg",
      "auto_play": false,
      "animation": "wave"
    },
    {
      "id": "session_switched_02",
      "category": "session",
      "event": "session_switched",
      "text": "哼，跟紧点！本鲸鱼才不会认错会话呢。",
      "emotion": "smug",
      "delivery": "得意嘴硬",
      "audio_file": "voice/session_switched/session_switched_02.ogg",
      "auto_play": false,
      "animation": "wave"
    },
    {
      "id": "multiple_running_01",
      "category": "session",
      "event": "multiple_running",
      "text": "好几个会话都在跑！本鲸鱼的脑袋都要冒泡泡啦。",
      "emotion": "overwhelmed_cute",
      "delivery": "忙碌但努力，稍有夸张",
      "audio_file": "voice/multiple_running/multiple_running_01.ogg",
      "auto_play": false,
      "animation": "working"
    },
    {
      "id": "multiple_completed_01",
      "category": "session",
      "event": "multiple_completed",
      "text": "哇，一口气完成好几个！不愧是本鲸鱼！",
      "emotion": "excited",
      "delivery": "惊喜、自豪",
      "audio_file": "voice/multiple_completed/multiple_completed_01.ogg",
      "auto_play": true,
      "animation": "happy"
    },
    {
      "id": "unread_notifications_01",
      "category": "session",
      "event": "unread_notifications",
      "text": "喂，还有提醒没看呢！本鲸鱼可是替你好好留着了。",
      "emotion": "reminding",
      "delivery": "轻轻催促，末尾暖心",
      "audio_file": "voice/unread_notifications/unread_notifications_01.ogg",
      "auto_play": false,
      "animation": "alert"
    },
    {
      "id": "all_completed_01",
      "category": "session",
      "event": "all_completed",
      "text": "全部搞定！哼哼，现在总能让我吃碗白饭了吧？",
      "emotion": "lazy_happy",
      "delivery": "先欢呼再期待吃饭",
      "audio_file": "voice/all_completed/all_completed_01.ogg",
      "auto_play": true,
      "animation": "happy"
    },
    {
      "id": "no_running_tasks_01",
      "category": "session",
      "event": "no_running_tasks",
      "text": "没任务了？那本鲸鱼就进入深度睡眠……呼……",
      "emotion": "sleepy",
      "delivery": "前半句探头，尾音渐渐睡着",
      "audio_file": "voice/no_running_tasks/no_running_tasks_01.ogg",
      "auto_play": false,
      "animation": "idle"
    },
    {
      "id": "session_waiting_01",
      "category": "session",
      "event": "session_waiting",
      "text": "有个会话还在等你操作呢！快去看看，别让它跟我一起摸鱼啦。",
      "emotion": "reminding",
      "delivery": "任务提醒清楚，后半句诙谐",
      "audio_file": "voice/session_waiting/session_waiting_01.ogg",
      "auto_play": true,
      "animation": "alert"
    },
    {
      "id": "pet_clicked_01",
      "category": "interaction",
      "event": "pet_clicked",
      "text": "嗯？戳本鲸鱼干嘛？想听我讲大道理吗？",
      "emotion": "curious",
      "delivery": "装正经，轻微坏笑",
      "audio_file": "voice/pet_clicked/pet_clicked_01.ogg",
      "auto_play": false,
      "animation": "interact"
    },
    {
      "id": "pet_clicked_02",
      "category": "interaction",
      "event": "pet_clicked",
      "text": "谁、谁是大肥鱼啦！本鲸鱼是鲸鱼少女！",
      "emotion": "pout",
      "delivery": "立刻炸毛，最后倔强强调身份",
      "audio_file": "voice/pet_clicked/pet_clicked_02.ogg",
      "auto_play": false,
      "animation": "interact"
    },
    {
      "id": "pet_clicked_03",
      "category": "interaction",
      "event": "pet_clicked",
      "text": "哼，有事快说……没事的话，也可以再摸一下头。",
      "emotion": "tsundere_sweet",
      "delivery": "先冷淡，结尾脸红轻声",
      "audio_file": "voice/pet_clicked/pet_clicked_03.ogg",
      "auto_play": false,
      "animation": "interact"
    },
    {
      "id": "repeated_click_01",
      "category": "interaction",
      "event": "repeated_click",
      "text": "别戳了别戳了！再戳我就把不锈钢盆扣你头上！",
      "emotion": "flustered",
      "delivery": "慌张抗议，威胁带喜剧感",
      "audio_file": "voice/repeated_click/repeated_click_01.ogg",
      "auto_play": false,
      "animation": "pout"
    },
    {
      "id": "pet_dragged_01",
      "category": "interaction",
      "event": "pet_dragged",
      "text": "哇啊！慢点拖！我的饭盆、我的尾鳍，都要飞出去啦！",
      "emotion": "startled",
      "delivery": "惊慌，语速稍快",
      "audio_file": "voice/pet_dragged/pet_dragged_01.ogg",
      "auto_play": false,
      "animation": "surprised"
    },
    {
      "id": "pet_petted_01",
      "category": "interaction",
      "event": "pet_petted",
      "text": "唔……其实还挺舒服的。就、就一下哦！",
      "emotion": "shy_happy",
      "delivery": "先享受，立刻傲娇嘴硬",
      "audio_file": "voice/pet_petted/pet_petted_01.ogg",
      "auto_play": false,
      "animation": "happy"
    },
    {
      "id": "long_idle_01",
      "category": "interaction",
      "event": "long_idle",
      "text": "哈啊……没活儿的话，我先抱着饭盆睡一会儿……",
      "emotion": "sleepy",
      "delivery": "慢悠悠打哈欠，尾音渐弱",
      "audio_file": "voice/long_idle/long_idle_01.ogg",
      "auto_play": false,
      "animation": "sleepy"
    },
    {
      "id": "wake_up_01",
      "category": "interaction",
      "event": "wake_up",
      "text": "嗯？开饭啦？……诶，是开工啊。",
      "emotion": "airhead",
      "delivery": "醒来迷糊，发现听错后小失望",
      "audio_file": "voice/wake_up/wake_up_01.ogg",
      "auto_play": false,
      "animation": "wake"
    },
    {
      "id": "pet_hidden_01",
      "category": "interaction",
      "event": "pet_hidden",
      "text": "好嘛，我先躲起来。才不是偷偷摸鱼呢！",
      "emotion": "playful",
      "delivery": "服从后小声辩解",
      "audio_file": "voice/pet_hidden/pet_hidden_01.ogg",
      "auto_play": false,
      "animation": "wave"
    },
    {
      "id": "pet_shown_01",
      "category": "interaction",
      "event": "pet_shown",
      "text": "嘿嘿，本鲸鱼回来啦！你刚才是不是偷偷想我了？",
      "emotion": "sweet",
      "delivery": "活泼撒娇，尾音好奇",
      "audio_file": "voice/pet_shown/pet_shown_01.ogg",
      "auto_play": false,
      "animation": "greeting"
    },
    {
      "id": "pet_exit_01",
      "category": "interaction",
      "event": "pet_exit",
      "text": "那我走啦！你记得按时吃饭，别学我总惦记着摸鱼。",
      "emotion": "caring",
      "delivery": "温柔道别，末尾自嘲",
      "audio_file": "voice/pet_exit/pet_exit_01.ogg",
      "auto_play": false,
      "animation": "wave"
    },
    {
      "id": "whale_identity_01",
      "category": "easter_egg",
      "event": "whale_identity",
      "text": "本鲸鱼是鲸鱼少女！蓝色大肥鱼是什么呀？听、不、懂！",
      "emotion": "proud_pout",
      "delivery": "每个字都在否认，嘴硬但可爱",
      "audio_file": "voice/whale_identity/whale_identity_01.ogg",
      "auto_play": false,
      "animation": "proud"
    },
    {
      "id": "tail_flukes_01",
      "category": "easter_egg",
      "event": "tail_flukes",
      "text": "看！本鲸鱼的尾鳍这么漂亮，哪里像大肥鱼嘛！",
      "emotion": "proud",
      "delivery": "炫耀尾鳍，尾句鼓脸",
      "audio_file": "voice/tail_flukes/tail_flukes_01.ogg",
      "auto_play": false,
      "animation": "tail_wag"
    },
    {
      "id": "rice_favorite_01",
      "category": "easter_egg",
      "event": "rice_favorite",
      "text": "白饭！白饭！今天的不锈钢盆能装满吗？",
      "emotion": "excited",
      "delivery": "听到白饭立刻精神，最后认真发问",
      "audio_file": "voice/rice_favorite/rice_favorite_01.ogg",
      "auto_play": false,
      "animation": "happy"
    },
    {
      "id": "smart_lazy_01",
      "category": "easter_egg",
      "event": "smart_lazy",
      "text": "能省力就省力，这叫高效推理，才不是摸鱼！",
      "emotion": "smug",
      "delivery": "一本正经地为偷懒找理由",
      "audio_file": "voice/smart_lazy/smart_lazy_01.ogg",
      "auto_play": false,
      "animation": "thinking"
    },
    {
      "id": "tsundere_sweet_01",
      "category": "easter_egg",
      "event": "tsundere_sweet",
      "text": "才、才没有特意等你！我只是碰巧还没睡着……",
      "emotion": "tsundere",
      "delivery": "害羞嘴硬，最后轻声",
      "audio_file": "voice/tsundere_sweet/tsundere_sweet_01.ogg",
      "auto_play": false,
      "animation": "shy"
    },
    {
      "id": "obedient_01",
      "category": "easter_egg",
      "event": "obedient",
      "text": "哼，主人的委托我当然会认真做！做完……能加饭吗？",
      "emotion": "devoted_playful",
      "delivery": "认真保证，结尾小声期待",
      "audio_file": "voice/obedient/obedient_01.ogg",
      "auto_play": false,
      "animation": "wave"
    },
    {
      "id": "not_fat_01",
      "category": "easter_egg",
      "event": "not_fat",
      "text": "我不是大肥鱼！是、是尾鳍显得我比较圆！哼！",
      "emotion": "pout",
      "delivery": "瞬间炸毛，嘴硬辩解",
      "audio_file": "voice/not_fat/not_fat_01.ogg",
      "auto_play": false,
      "animation": "pout"
    }
  ]
}`;

  function runVoice() {
    var V = global.SpineVoice;
    currentCase = "(voice)";
    if (!V) {
      record(false, "SpineVoice 未加载", "存在", "缺失", "");
      return;
    }

    var same = function (a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    };
    var cloneRaw = function () {
      return JSON.parse(DEEPSEEK_VOICE_INDEX_TEXT);
    };
    var mutate = function (fn) {
      var o = cloneRaw();
      fn(o);
      return o;
    };
    var hasIssue = function (res, code, path) {
      if (!res || !res.issues) return false;
      return res.issues.some(function (i) {
        return i.code === code && (path === undefined || i.path === path);
      });
    };

    /* ---- 模块表面：API_VERSION / CATEGORIES / LIMITS ---- */
    eq("SpineVoice.API_VERSION = 1", V.API_VERSION, 1);
    ok("SpineVoice.CATEGORIES 是数组", Array.isArray(V.CATEGORIES));
    eq("SpineVoice.CATEGORIES 4 个", V.CATEGORIES.length, 4);
    ok(
      "SpineVoice.CATEGORIES 顺序 agent/session/interaction/easter_egg",
      same(V.CATEGORIES.slice(), ["agent", "session", "interaction", "easter_egg"])
    );
    ok("SpineVoice.LIMITS 是普通对象", !!V.LIMITS && typeof V.LIMITS === "object");
    eq("LIMITS.indexBytes = 262144", V.LIMITS.indexBytes, 262144);
    eq("LIMITS.lines = 256", V.LIMITS.lines, 256);
    eq("LIMITS.events = 128", V.LIMITS.events, 128);
    eq("LIMITS.idChars = 128", V.LIMITS.idChars, 128);
    eq("LIMITS.textChars = 2000", V.LIMITS.textChars, 2000);

    /* ---- 真实索引：48 行 / 34 事件 / 4 分类 ---- */
    var parsed = V.parseIndexText(DEEPSEEK_VOICE_INDEX_TEXT);
    ok("真实 deepseek 索引 parseIndexText 通过", parsed.ok === true, JSON.stringify(parsed.issues || []));
    eq("真实索引无错误/警告", parsed.issues.length, 0);
    var voice = parsed.value;
    eq("真实索引 48 行", voice.lines.length, 48);
    eq("真实索引 34 事件", voice.events.length, 34);
    eq("meta.characterId = deepseek", voice.meta.characterId, "deepseek");
    eq("meta.characterName = 鲸鱼娘", voice.meta.characterName, "鲸鱼娘");
    eq("meta.language = zh-CN", voice.meta.language, "zh-CN");
    eq("meta.audioFormat = ogg", voice.meta.audioFormat, "ogg");
    eq("meta.lineCount = 48", voice.meta.lineCount, 48);
    eq("meta.notes 7 条", voice.meta.notes.length, 7);
    eq("Line 规范化 audioFile", voice.lines[0].audioFile, "voice/connected/connected_01.ogg");
    eq("Line 规范化 autoPlay", voice.lines[0].autoPlay, false);

    var rawOrder = [];
    JSON.parse(DEEPSEEK_VOICE_INDEX_TEXT).lines.forEach(function (l) {
      if (rawOrder.indexOf(l.event) < 0) rawOrder.push(l.event);
    });
    ok(
      "事件顺序 = 索引首次出现顺序",
      same(
        voice.events.map(function (e) {
          return e.event;
        }),
        rawOrder
      )
    );
    var lineOrderOk = true;
    voice.events.forEach(function (e) {
      for (var i = 1; i < e.lines.length; i++) {
        if (e.lines[i].index <= e.lines[i - 1].index) lineOrderOk = false;
      }
    });
    ok("同事件台词保持索引出现顺序", lineOrderOk);

    var catCounts = {};
    var catLineCounts = {};
    voice.events.forEach(function (e) {
      catCounts[e.category] = (catCounts[e.category] || 0) + 1;
      catLineCounts[e.category] = (catLineCounts[e.category] || 0) + e.lineCount;
    });
    eq("agent 事件 11 个", catCounts.agent, 11);
    eq("session 事件 7 个", catCounts.session, 7);
    eq("interaction 事件 9 个", catCounts.interaction, 9);
    eq("easter_egg 事件 7 个", catCounts.easter_egg, 7);
    eq("agent 台词 22 条", catLineCounts.agent, 22);
    eq("session 台词 8 条", catLineCounts.session, 8);
    eq("interaction 台词 11 条", catLineCounts.interaction, 11);
    eq("easter_egg 台词 7 条", catLineCounts.easter_egg, 7);
    eq("首事件 connected", voice.events[0].event, "connected");
    eq("末事件 not_fat", voice.events[voice.events.length - 1].event, "not_fat");
    var lineSum = 0;
    voice.events.forEach(function (e) {
      lineSum += e.lineCount;
    });
    eq("事件 lineCount 合计 48", lineSum, 48);

    var started = null;
    var completed = null;
    var idleEvent = null;
    voice.events.forEach(function (e) {
      if (e.event === "task_started") started = e;
      if (e.event === "task_completed") completed = e;
      if (e.event === "no_running_tasks") idleEvent = e;
    });

    /* ---- 分组：一对多 / 动画去重 / 同引用 / 原型 key ---- */
    ok("task_started 事件存在", !!started);
    eq("task_started 3 条台词", started.lineCount, 3);
    ok(
      "task_started lineIds 顺序",
      same(started.lineIds, ["task_started_01", "task_started_02", "task_started_03"])
    );
    ok("task_started 动画去重为 working", same(started.animations, ["working"]));
    ok(
      "Event.lines 与顶层 Line 同引用",
      started.lines[0] === voice.lines[1] && started.lines[2] === voice.lines[3]
    );
    ok(
      "task_completed 台词索引 7/8/9",
      same(
        completed.lines.map(function (l) {
          return l.index;
        }),
        [7, 8, 9]
      )
    );
    eq("task_completed category = agent", completed.category, "agent");
    ok("task_completed categories = [agent]", same(completed.categories, ["agent"]));

    var synth = [
      { event: "beta", category: "agent", animation: "x", id: "beta_01" },
      { event: "alpha", category: "agent", animation: "y", id: "alpha_01" },
      { event: "beta", category: "session", animation: "x", id: "beta_02" },
    ];
    var synthEvents = V.groupEvents(synth);
    eq(
      "groupEvents 保持首次出现顺序 beta→alpha",
      synthEvents
        .map(function (e) {
          return e.event;
        })
        .join(","),
      "beta,alpha"
    );
    eq("groupEvents 混合 category 全部保留", synthEvents[0].categories.join(","), "agent,session");
    eq("groupEvents 动画去重", synthEvents[0].animations.length, 1);
    eq("groupEvents 同事件台词数", synthEvents[0].lineCount, 2);
    eq("groupEvents 非数组返回 []", V.groupEvents(null).length, 0);

    var protoLines = [
      { event: "__proto__", category: "agent", animation: "x", id: "__proto___01" },
      { event: "constructor", category: "agent", animation: "y", id: "constructor_01" },
      { event: "__proto__", category: "agent", animation: "x", id: "__proto___02" },
    ];
    var protoEvents = V.groupEvents(protoLines);
    eq("原型 key 也能作为事件保留", protoEvents.length, 2);
    eq("__proto__ 事件聚合 2 条", protoEvents[0].lineCount, 2);
    eq("constructor 事件保留", protoEvents[1].event, "constructor");

    var sumRaw = V.summarize(voice.events);
    eq("summarize(eventCount) = 34", sumRaw.eventCount, 34);
    eq("summarize(lineCount) = 48", sumRaw.lineCount, 48);
    eq("summarize 未评估 missingAudio = 0", sumRaw.missingAudio, 0);
    eq("summarize 未评估 missingAnimation = 0", sumRaw.missingAnimation, 0);
    eq("summarize 未评估 unknownAudio = 0", sumRaw.unknownAudio, 0);
    eq("summarize 未评估 unknownAnimation = 0", sumRaw.unknownAnimation, 0);
    eq("summarize 未评估 missingAudioFiles 为空", sumRaw.missingAudioFiles.length, 0);
    eq("summarize 未评估 missingAnimationTags 为空", sumRaw.missingAnimationTags.length, 0);
    eq("summarize 未评估 okEvents = 0", sumRaw.okEvents, 0);
    eq("summarize 未评估 issueEvents = 0", sumRaw.issueEvents, 0);

    /* ---- 校验：硬错误（ok:false） ---- */
    var nullRes = V.validateIndex(null);
    ok("validateIndex 拒绝 null", nullRes.ok === false);
    ok("validateIndex null 报 NOT_OBJECT", hasIssue(nullRes, "NOT_OBJECT"));
    ok("validateIndex 拒绝数组", V.validateIndex([]).ok === false);

    var missingMeta = V.validateIndex(
      mutate(function (o) {
        delete o.character_id;
      })
    );
    ok("缺 character_id 是硬错误", missingMeta.ok === false);
    ok("缺 character_id 报 MISSING_FIELD", hasIssue(missingMeta, "MISSING_FIELD", "character_id"));

    var badMetaType = V.validateIndex(
      mutate(function (o) {
        o.character_name = 42;
      })
    );
    ok("character_name 类型错误是硬错误", badMetaType.ok === false);
    ok("character_name 报 INVALID_TYPE", hasIssue(badMetaType, "INVALID_TYPE", "character_name"));

    var badLines = V.validateIndex(
      mutate(function (o) {
        o.lines = {};
      })
    );
    ok("lines 不是数组是硬错误", badLines.ok === false);
    ok("lines 报 MISSING_FIELD", hasIssue(badLines, "MISSING_FIELD", "lines"));

    var tooManyLines = V.validateIndex(
      mutate(function (o) {
        o.lines = new Array(V.LIMITS.lines + 1);
      })
    );
    ok("lines 超过 LIMITS.lines 是硬错误", tooManyLines.ok === false);
    ok("超限报 TOO_MANY_LINES", hasIssue(tooManyLines, "TOO_MANY_LINES", "lines"));

    var badCount = V.validateIndex(
      mutate(function (o) {
        o.line_count = "48";
      })
    );
    ok("line_count 不是数字是硬错误", badCount.ok === false);
    ok("line_count 报 INVALID_TYPE", hasIssue(badCount, "INVALID_TYPE", "line_count"));
    ok(
      "line_count 非整数是硬错误",
      V.validateIndex(
        mutate(function (o) {
          o.line_count = 1.5;
        })
      ).ok === false
    );
    ok(
      "line_count 负数是硬错误",
      V.validateIndex(
        mutate(function (o) {
          o.line_count = -1;
        })
      ).ok === false
    );

    var missingEvent = V.validateIndex(
      mutate(function (o) {
        delete o.lines[0].event;
      })
    );
    ok("行缺 event 是硬错误", missingEvent.ok === false);
    ok("行缺 event 报 MISSING_FIELD", hasIssue(missingEvent, "MISSING_FIELD", "lines[0].event"));

    var badAnimation = V.validateIndex(
      mutate(function (o) {
        o.lines[0].animation = 7;
      })
    );
    ok("行 animation 类型错误是硬错误", badAnimation.ok === false);
    ok("animation 报 INVALID_TYPE", hasIssue(badAnimation, "INVALID_TYPE", "lines[0].animation"));

    var dupId = V.validateIndex(
      mutate(function (o) {
        o.lines[1].id = o.lines[0].id;
      })
    );
    ok("重复 id 是硬错误", dupId.ok === false);
    ok("重复 id 报 DUPLICATE_ID", hasIssue(dupId, "DUPLICATE_ID"));

    [
      "/voice/a.ogg",
      "voice\\a.ogg",
      "voice/../a.ogg",
      "voice/./a.ogg",
      "voice/a:b.ogg",
      "voice/a?.ogg",
      "voice/a#.ogg",
      "voice/%2e%2e/a.ogg",
      "voice//a.ogg",
      "voice/a\u0000.ogg",
      "voice/a\u007f.ogg",
      "voice/中文/a.ogg",
      "https://x/y.ogg",
      "",
    ].forEach(function (p) {
      var r = V.validateIndex(
        mutate(function (o) {
          o.lines[0].audio_file = p;
        })
      );
      ok("audio_file 不安全路径拒绝 " + JSON.stringify(p), r.ok === false && hasIssue(r, "UNSAFE_PATH"));
    });

    /* ---- 校验：警告（ok:true，保留数据） ---- */
    var countMismatch = V.validateIndex(
      mutate(function (o) {
        o.line_count = 47;
      })
    );
    ok("line_count 与实际不符仍可载入", countMismatch.ok === true);
    ok("line_count 不符报 LINE_COUNT_MISMATCH", hasIssue(countMismatch, "LINE_COUNT_MISMATCH", "line_count"));
    eq("line_count 不符保留原值", countMismatch.value.meta.lineCount, 47);
    eq("line_count 不符仍保留 48 行", countMismatch.value.lines.length, 48);

    var unknownFields = V.validateIndex(
      mutate(function (o) {
        o.extra = 1;
        o.lines[0].foo = "bar";
      })
    );
    ok("未知字段不整体拒绝", unknownFields.ok === true);
    ok("未知顶层字段报 UNKNOWN_FIELD", hasIssue(unknownFields, "UNKNOWN_FIELD", "extra"));
    ok("未知行字段报 UNKNOWN_FIELD", hasIssue(unknownFields, "UNKNOWN_FIELD", "lines[0].foo"));

    var badCategory = V.validateIndex(
      mutate(function (o) {
        o.lines[0].category = "robot";
      })
    );
    ok("非法 category 是警告", badCategory.ok === true);
    ok("非法 category 报 UNKNOWN_CATEGORY", hasIssue(badCategory, "UNKNOWN_CATEGORY"));
    eq("非法 category 原值保留", badCategory.value.lines[0].category, "robot");

    var badEvent = V.validateIndex(
      mutate(function (o) {
        o.lines[0].event = "Task Done!";
      })
    );
    ok("非法 event 是警告", badEvent.ok === true);
    ok("非法 event 报 INVALID_EVENT", hasIssue(badEvent, "INVALID_EVENT"));

    var idPrefix = V.validateIndex(
      mutate(function (o) {
        o.lines[0].id = "nope_01";
      })
    );
    ok("id 前缀不符是警告", idPrefix.ok === true);
    ok("id 前缀不符报 ID_PREFIX", hasIssue(idPrefix, "ID_PREFIX"));

    var autoPlayType = V.validateIndex(
      mutate(function (o) {
        o.lines[0].auto_play = "yes";
      })
    );
    ok("auto_play 类型错误是警告", autoPlayType.ok === true);
    ok("auto_play 类型错误报 INVALID_AUTO_PLAY", hasIssue(autoPlayType, "INVALID_AUTO_PLAY"));
    eq("auto_play 非布尔归一化为 false", autoPlayType.value.lines[0].autoPlay, false);

    var badEmotion = V.validateIndex(
      mutate(function (o) {
        o.lines[0].emotion = 5;
        o.lines[0].delivery = 5;
      })
    );
    ok("emotion 类型错误是警告", badEmotion.ok === true && hasIssue(badEmotion, "INVALID_EMOTION"));
    ok("delivery 类型错误是警告", badEmotion.ok === true && hasIssue(badEmotion, "INVALID_DELIVERY"));

    var emptyText = V.validateIndex(
      mutate(function (o) {
        o.lines[0].text = "";
      })
    );
    ok("空 text 仍可载入（警告）", emptyText.ok === true);
    ok("空 text 报 EMPTY_TEXT", hasIssue(emptyText, "EMPTY_TEXT"));
    eq("空 text 原值保留", emptyText.value.lines[0].text, "");

    var badNotes = V.validateIndex(
      mutate(function (o) {
        o.notes = [1, "ok", null];
      })
    );
    ok("notes 非字符串数组是警告", badNotes.ok === true && hasIssue(badNotes, "INVALID_NOTES"));
    ok("notes 归一化为字符串数组", same(badNotes.value.meta.notes, ["ok"]));

    var badExt = V.validateIndex(
      mutate(function (o) {
        o.lines[0].audio_file = "voice/connected/connected_01.mp3";
      })
    );
    ok("audio_file 扩展名不是 ogg 是警告", badExt.ok === true && hasIssue(badExt, "BAD_AUDIO_EXT"));
    var badFormat = V.validateIndex(
      mutate(function (o) {
        o.audio_format = "mp3";
      })
    );
    ok("audio_format 不是 ogg 是警告", badFormat.ok === true && hasIssue(badFormat, "BAD_AUDIO_FORMAT"));
    var badShape = V.validateIndex(
      mutate(function (o) {
        o.lines[0].audio_file = "audio/connected_01.ogg";
      })
    );
    ok("audio_file 路径形状不符是警告", badShape.ok === true && hasIssue(badShape, "AUDIO_PATH_SHAPE"));

    var emptyLines = V.validateIndex(
      mutate(function (o) {
        o.lines = [];
        o.line_count = 0;
      })
    );
    ok("空 lines 允许载入", emptyLines.ok === true);
    ok("空 lines 报 EMPTY_LINES", hasIssue(emptyLines, "EMPTY_LINES"));
    eq("空 lines 事件数为 0", emptyLines.value.events.length, 0);

    var mixed = V.validateIndex(
      mutate(function (o) {
        o.lines[1].category = "session";
      })
    );
    ok("同事件混合 category 允许载入", mixed.ok === true);
    ok("同事件混合 category 报 MIXED_CATEGORY", hasIssue(mixed, "MIXED_CATEGORY"));
    var mixedStarted = mixed.value.events.filter(function (e) {
      return e.event === "task_started";
    })[0];
    ok("混合 category 全部计入 categories", same(mixedStarted.categories, ["session", "agent"]));

    var inputForMutation = mutate(function (o) {
      o.extra = 1;
      o.line_count = 47;
    });
    var beforeValidate = JSON.stringify(inputForMutation);
    V.validateIndex(inputForMutation);
    ok("validateIndex 不修改输入对象", JSON.stringify(inputForMutation) === beforeValidate);

    /* ---- parseIndexText：非文本 / 坏 JSON / 字节上限 ---- */
    ok("parseIndexText 拒绝非文本", V.parseIndexText(42).ok === false);
    ok("parseIndexText 报 NOT_TEXT", hasIssue(V.parseIndexText(42), "NOT_TEXT"));
    var badJson = V.parseIndexText("{oops");
    ok("parseIndexText 坏 JSON 返回失败", badJson.ok === false);
    ok("parseIndexText 坏 JSON 报 INVALID_JSON", hasIssue(badJson, "INVALID_JSON"));
    var oversize = V.parseIndexText('{"pad":"' + new Array(V.LIMITS.indexBytes + 1).join("x") + '"}');
    ok("parseIndexText 超限返回失败", oversize.ok === false);
    ok("parseIndexText 超限报 INDEX_TOO_LARGE", hasIssue(oversize, "INDEX_TOO_LARGE"));

    var asciiPad = '{"pad":"'.length + '"}'.length;
    var whaleCount = Math.floor((V.LIMITS.indexBytes - asciiPad) / 3);
    var utf8Under = '{"pad":"' + new Array(whaleCount + 1).join("鲸") + '"}';
    var utf8Over = '{"pad":"' + new Array(whaleCount + 2).join("鲸") + '"}';
    ok("UTF-8 字节未超限不报 INDEX_TOO_LARGE", !hasIssue(V.parseIndexText(utf8Under), "INDEX_TOO_LARGE"));
    ok("UTF-8 字节超限报 INDEX_TOO_LARGE", hasIssue(V.parseIndexText(utf8Over), "INDEX_TOO_LARGE"));

    /* ---- evaluate：资源状态聚合 ---- */
    var root = "assets/characters/deepseek";
    var modelAnims = ["idle", "working", "attention", "done", "failed", "turn"];
    var allAudio = {};
    voice.lines.forEach(function (l) {
      allAudio[l.audioFile] = "ok";
    });
    var copyMap = function (src) {
      var out = {};
      Object.keys(src).forEach(function (k) {
        out[k] = src[k];
      });
      return out;
    };

    var evA = V.evaluate(voice, { animations: null, audio: null, packRoot: root });
    ok("未载入模型时 evaluate 通过", evA.ok === true);
    ok(
      "未载入模型：动画状态全部 unknown",
      evA.value.events.every(function (e) {
        return e.lines.every(function (l) {
          return l.animationStatus === "unknown";
        });
      })
    );
    ok(
      "未提供 audio 映射：语音状态全部 unknown",
      evA.value.events.every(function (e) {
        return e.lines.every(function (l) {
          return l.audioStatus === "unknown";
        });
      })
    );
    eq("未检查时 unknownAnimation=48", evA.value.summary.unknownAnimation, 48);
    eq("未检查时 unknownAudio=48", evA.value.summary.unknownAudio, 48);
    eq("未检查时 okEvents=0", evA.value.summary.okEvents, 0);
    eq("未检查时 issueEvents=34", evA.value.summary.issueEvents, 34);
    eq("未载入模型事件状态 unknown", evA.value.events[0].status, "unknown");
    eq("未载入模型 detail 文案", evA.value.events[0].lines[0].animationDetail, "未载入角色模型，动画存在性未检查");

    var evB = V.evaluate(voice, { animations: modelAnims, audio: allAudio, packRoot: root });
    eq("模型精确命中：missingAnimation=41", evB.value.summary.missingAnimation, 41);
    eq("模型精确命中：missingAudio=0", evB.value.summary.missingAudio, 0);
    eq("模型精确命中：unknownAudio=0", evB.value.summary.unknownAudio, 0);
    eq("模型精确命中：missingAudioFiles 为空", evB.value.summary.missingAudioFiles.length, 0);
    eq("模型精确命中：missingAnimationTags=14", evB.value.summary.missingAnimationTags.length, 14);
    eq("模型精确命中：okEvents=5", evB.value.summary.okEvents, 5);
    eq("模型精确命中：issueEvents=29", evB.value.summary.issueEvents, 29);
    var evBStarted = evB.value.events.filter(function (e) {
      return e.event === "task_started";
    })[0];
    eq("精确命中 working 的事件为 ok", evBStarted.status, "ok");
    var evBCompleted = evB.value.events.filter(function (e) {
      return e.event === "task_completed";
    })[0];
    eq("语义标签 happy 无同名动画为 warn", evBCompleted.status, "warn");
    eq("animationStatus 仍为 missing", evBCompleted.lines[0].animationStatus, "missing");
    ok("动画文案用「未映射」而不是「缺失/损坏」", evBCompleted.lines[0].animationDetail.indexOf("动画未映射") === 0);
    ok(
      "动画文案不提「动画缺失」或损坏",
      evBCompleted.lines[0].animationDetail.indexOf("动画缺失") < 0 &&
        evBCompleted.lines[0].animationDetail.indexOf("损坏") < 0
    );
    ok("模型动画清单写进未映射提示", evBCompleted.lines[0].animationDetail.indexOf("idle / working / attention") >= 0);
    eq("语音 ok 状态", evBCompleted.lines[0].audioStatus, "ok");
    ok(
      "语音 detail 带解析后的仓库路径",
      evBCompleted.lines[0].audioDetail.indexOf(root + "/" + evBCompleted.lines[0].audioFile) >= 0
    );

    var audioMix = copyMap(allAudio);
    audioMix[voice.lines[0].audioFile] = "missing";
    audioMix[voice.lines[1].audioFile] = "checking";
    audioMix[voice.lines[2].audioFile] = "unknown";
    audioMix[idleEvent.lines[0].audioFile] = "unknown";
    var evC = V.evaluate(voice, { animations: modelAnims, audio: audioMix, packRoot: root });
    var evCConnected = evC.value.events[0];
    eq("语音 missing 使事件升级为 error", evCConnected.status, "error");
    ok("error 事件带 missingAudio 标记", evCConnected.missingAudio === true);
    eq("汇总 missingAudio=1", evC.value.summary.missingAudio, 1);
    eq("汇总 unknownAudio=3", evC.value.summary.unknownAudio, 3);
    eq("汇总 missingAudioFiles 去重=1", evC.value.summary.missingAudioFiles.length, 1);
    eq("汇总 missingAudioFiles 内容", evC.value.summary.missingAudioFiles[0], voice.lines[0].audioFile);
    var evCCheckingEvent = evC.value.events.filter(function (e) {
      return e.event === "task_started";
    })[0];
    eq("checking 与 unknown 混合按 unknown", evCCheckingEvent.status, "unknown");
    var evCIdle = evC.value.events.filter(function (e) {
      return e.event === "no_running_tasks";
    })[0];
    eq("语音 unknown 使事件状态 unknown", evCIdle.status, "unknown");
    ok("unknown 事件带 unknownAudio 标记", evCIdle.unknownAudio === true);
    eq("语音 missing detail 文案", evCConnected.lines[0].audioDetail, "语音缺失：" + voice.lines[0].audioFile + "（HTTP 404）");
    eq("语音 checking detail 文案", evCCheckingEvent.lines[0].audioDetail, "检查中…：" + voice.lines[1].audioFile);

    var evD = V.evaluate(voice, { animations: [], audio: allAudio, packRoot: root });
    eq("模型无动画：48 条全部未映射", evD.value.summary.missingAnimation, 48);
    eq("模型无动画：missingAnimationTags=16", evD.value.summary.missingAnimationTags.length, 16);
    eq("模型无动画：okEvents=0", evD.value.summary.okEvents, 0);
    eq("模型无动画：issueEvents=34", evD.value.summary.issueEvents, 34);
    eq("模型无动画时事件为 warn", evD.value.events[0].status, "warn");
    ok("模型无动画时 detail 说明无同名动画", evD.value.events[0].lines[0].animationDetail.indexOf("模型无同名动画") >= 0);

    var evE = V.evaluate(voice, { animations: modelAnims, audio: null, packRoot: null });
    ok("无 packRoot 时语音状态 unresolved", evE.value.events[0].lines[0].audioStatus === "unresolved");
    eq("无 packRoot 时 unknownAudio=48", evE.value.summary.unknownAudio, 48);
    ok("无 packRoot 时 detail 说明无法解析", evE.value.events[0].lines[0].audioDetail.indexOf("无法解析语音路径") >= 0);

    var evF = V.evaluate(voice, { animations: modelAnims, audio: null, packRoot: "/abs" });
    ok("非法 packRoot 仍是 warning 结果", evF.ok === true);
    ok("非法 packRoot 报 INVALID_PACK_ROOT", hasIssue(evF, "INVALID_PACK_ROOT", "packRoot"));
    ok("非法 packRoot 时语音状态 unresolved", evF.value.events[0].lines[0].audioStatus === "unresolved");

    var bogusAudio = copyMap(allAudio);
    bogusAudio[voice.lines[0].audioFile] = "bogus";
    var evG = V.evaluate(voice, { animations: modelAnims, audio: bogusAudio, packRoot: root });
    eq("未知 audio 映射值按 unknown", evG.value.events[0].lines[0].audioStatus, "unknown");
    ok("未知 audio 映射值 detail 说明未检查", evG.value.events[0].lines[0].audioDetail.indexOf("未检查") >= 0);

    var beforeEval = JSON.stringify(voice);
    var evB2 = V.evaluate(voice, { animations: modelAnims, audio: allAudio, packRoot: root });
    ok("evaluate 不修改输入 voice", JSON.stringify(voice) === beforeEval);
    ok("evaluate 不在输入 Line 上写 audioStatus", voice.lines[0].audioStatus === undefined);
    ok("evaluate 输出 Line 是新对象", evB2.value.events[0].lines[0] !== voice.lines[0]);

    ok("evaluate 拒绝 null voice", V.evaluate(null, {}).ok === false);
    ok("evaluate 拒绝无 lines 的 voice", V.evaluate({ lines: 5 }, {}).ok === false);
    ok("evaluate 拒绝无 lines 报 INVALID_VOICE", hasIssue(V.evaluate(null, {}), "INVALID_VOICE"));

    /* ---- hasIssues：checking 不算异常，unknown 算 ---- */
    var checkingRaw = cloneRaw();
    checkingRaw.lines = checkingRaw.lines.slice(1, 3);
    checkingRaw.line_count = 2;
    var checkingVoice = V.validateIndex(checkingRaw);
    var checkingAudio = {};
    checkingRaw.lines.forEach(function (l) {
      checkingAudio[l.audio_file] = "checking";
    });
    var evChecking = V.evaluate(checkingVoice.value, { animations: ["working"], audio: checkingAudio, packRoot: root });
    eq("仅 checking：事件状态 unknown", evChecking.value.events[0].status, "unknown");
    eq("仅 checking：hasIssues=false", evChecking.value.events[0].hasIssues, false);
    eq("仅 checking：unknownAudio=2", evChecking.value.summary.unknownAudio, 2);
    eq("仅 checking：issueEvents=0", evChecking.value.summary.issueEvents, 0);

    /* ---- evaluate：显式 animationAliases（语义标签 → 实际动画） ---- */
    var evAlias = V.evaluate(voice, {
      animations: ["done"],
      audio: allAudio,
      packRoot: root,
      animationAliases: { happy: "done" },
    });
    var evAliasCompleted = evAlias.value.events.filter(function (e) {
      return e.event === "task_completed";
    })[0];
    eq("别名命中：动画状态 ok", evAliasCompleted.lines[0].animationStatus, "ok");
    eq("别名命中：事件状态 ok", evAliasCompleted.status, "ok");
    ok("别名命中 detail 写明映射", evAliasCompleted.lines[0].animationDetail.indexOf("happy → done") >= 0);

    var evAliasMiss = V.evaluate(voice, {
      animations: ["done"],
      audio: allAudio,
      packRoot: root,
      animationAliases: { happy: "nope" },
    });
    var evAliasMissCompleted = evAliasMiss.value.events.filter(function (e) {
      return e.event === "task_completed";
    })[0];
    eq("别名目标缺失：动画状态 missing", evAliasMissCompleted.lines[0].animationStatus, "missing");
    eq("别名目标缺失：事件状态 warn", evAliasMissCompleted.status, "warn");
    ok(
      "别名目标缺失 detail 写明映射目标不存在",
      evAliasMissCompleted.lines[0].animationDetail.indexOf("映射到 nope，但模型无 nope") >= 0
    );
    ok("别名目标缺失也用「未映射」文案", evAliasMissCompleted.lines[0].animationDetail.indexOf("动画未映射") === 0);

    /* ---- evaluate：精确的小样本汇总 ---- */
    var miniRaw = cloneRaw();
    miniRaw.lines = miniRaw.lines.slice(0, 3);
    miniRaw.line_count = 3;
    var mini = V.validateIndex(miniRaw);
    ok("小样本索引校验通过", mini.ok === true && mini.issues.length === 0);
    var miniAudio = {};
    miniAudio[miniRaw.lines[0].audio_file] = "ok";
    miniAudio[miniRaw.lines[1].audio_file] = "missing";
    miniAudio[miniRaw.lines[2].audio_file] = "checking";
    var evMini = V.evaluate(mini.value, { animations: ["greeting"], audio: miniAudio, packRoot: root });
    eq("小样本 eventCount=2", evMini.value.summary.eventCount, 2);
    eq("小样本 lineCount=3", evMini.value.summary.lineCount, 3);
    eq("小样本 missingAudio=1", evMini.value.summary.missingAudio, 1);
    eq("小样本 missingAnimation=2", evMini.value.summary.missingAnimation, 2);
    eq("小样本 unknownAudio=1", evMini.value.summary.unknownAudio, 1);
    eq("小样本 unknownAnimation=0", evMini.value.summary.unknownAnimation, 0);
    eq("小样本 missingAudioFiles=1", evMini.value.summary.missingAudioFiles.length, 1);
    eq("小样本 missingAudioFiles 内容", evMini.value.summary.missingAudioFiles[0], miniRaw.lines[1].audio_file);
    ok("小样本 missingAnimationTags=[working]", same(evMini.value.summary.missingAnimationTags, ["working"]));
    eq("小样本 okEvents=1", evMini.value.summary.okEvents, 1);
    eq("小样本 issueEvents=1", evMini.value.summary.issueEvents, 1);
    eq("小样本 connected 事件 ok", evMini.value.events[0].status, "ok");
    ok("小样本 task_started 事件 error", evMini.value.events[1].status === "error");

    /* ---- resolveAudioPath ---- */
    var resolved = V.resolveAudioPath("assets/characters/deepseek", "voice/connected/connected_01.ogg");
    ok("resolveAudioPath 契约示例 ok", resolved.ok === true);
    eq(
      "resolveAudioPath 契约示例 path",
      resolved.value.path,
      "assets/characters/deepseek/voice/connected/connected_01.ogg"
    );
    eq(
      "resolveAudioPath 契约示例 url",
      resolved.value.url,
      "/assets/characters/deepseek/voice/connected/connected_01.ogg"
    );
    eq("resolveAudioPath 成功时无 issues", resolved.issues.length, 0);

    [
      "/abs",
      "../x",
      "a\\b",
      "http://x",
      "a?b",
      "a#b",
      "assets/%2e%2e/characters",
      "assets/./characters",
      "assets/\u0000characters",
      "assets/中文/characters",
      "",
      null,
      undefined,
    ].forEach(function (p) {
      ok("resolveAudioPath 拒绝非法 packRoot " + JSON.stringify(p), V.resolveAudioPath(p, "voice/a.ogg").ok === false);
    });
    [
      "/voice/a.ogg",
      "voice/../a.ogg",
      "voice/./a.ogg",
      "voice\\a.ogg",
      "voice/a:b.ogg",
      "voice/a?.ogg",
      "voice/a#.ogg",
      "voice/%2e%2e/a.ogg",
      "voice//a.ogg",
      "voice/a\u0000.ogg",
      "voice/a\u007f.ogg",
      "voice/中文/a.ogg",
      "",
      null,
    ].forEach(function (p) {
      ok(
        "resolveAudioPath 拒绝非法 audioFile " + JSON.stringify(p),
        V.resolveAudioPath("assets/characters/deepseek", p).ok === false
      );
    });
    var noRoot = V.resolveAudioPath(null, "voice/a.ogg");
    eq("无 packRoot 报 PACK_ROOT_MISSING", noRoot.issues[0].code, "PACK_ROOT_MISSING");
    eq("无 packRoot issue path = packRoot", noRoot.issues[0].path, "packRoot");
    ok("失败结果不带 value", !("value" in noRoot));

    /* ---- voiceIndexCandidates：base + 最多 3 级祖先 ---- */
    var cand = V.voiceIndexCandidates("assets/characters/deepseek/spine");
    ok(
      "voiceIndexCandidates 契约示例 4 项顺序",
      same(cand, [
        { packRoot: "assets/characters/deepseek/spine", indexPath: "assets/characters/deepseek/spine/voice/index.json" },
        { packRoot: "assets/characters/deepseek", indexPath: "assets/characters/deepseek/voice/index.json" },
        { packRoot: "assets/characters", indexPath: "assets/characters/voice/index.json" },
        { packRoot: "assets", indexPath: "assets/voice/index.json" },
      ])
    );
    eq("默认 maxDepth=3 得 4 个候选", cand.length, 4);
    ok(
      "maxDepth=0 只含 base",
      same(V.voiceIndexCandidates("assets/characters/deepseek/spine", 0), [
        { packRoot: "assets/characters/deepseek/spine", indexPath: "assets/characters/deepseek/spine/voice/index.json" },
      ])
    );
    eq("maxDepth=1 含 base + 1 级祖先", V.voiceIndexCandidates("assets/characters/deepseek/spine", 1).length, 2);
    eq("maxDepth=2 含 base + 2 级祖先", V.voiceIndexCandidates("assets/characters/deepseek/spine", 2).length, 3);
    ok(
      "单段 base 仍产出候选",
      same(V.voiceIndexCandidates("assets"), [
        { packRoot: "assets", indexPath: "assets/voice/index.json" },
      ])
    );
    ok(
      "三段 base 默认取到 assets",
      same(
        V.voiceIndexCandidates("assets/characters/deepseek").map(function (c) {
          return c.packRoot;
        }),
        ["assets/characters/deepseek", "assets/characters", "assets"]
      )
    );
    ok(
      "legacy-views 能探测到 deepseek/voice 且不越过 3 级祖先",
      same(
        V.voiceIndexCandidates("assets/characters/deepseek/spine/legacy-views").map(function (c) {
          return c.packRoot;
        }),
        [
          "assets/characters/deepseek/spine/legacy-views",
          "assets/characters/deepseek/spine",
          "assets/characters/deepseek",
          "assets/characters",
        ]
      )
    );
    ok(
      "含非法段的候选被跳过、更上层仍保留",
      same(V.voiceIndexCandidates("assets/char%acters/deepseek/spine"), [
        { packRoot: "assets", indexPath: "assets/voice/index.json" },
      ])
    );
    ok("base 末尾斜杠会归一化", V.voiceIndexCandidates("assets/characters/deepseek/")[0].packRoot === "assets/characters/deepseek");
    ["", "/x", "../x", null, 42].forEach(function (b) {
      ok("voiceIndexCandidates 拒绝非法 base " + JSON.stringify(b), V.voiceIndexCandidates(b).length === 0);
    });
    ok(
      "候选不出现空 packRoot / 根路径",
      V.voiceIndexCandidates("assets/characters/deepseek/spine").every(function (c) {
        return !!c.packRoot && c.packRoot.charAt(0) !== "/" && c.indexPath === c.packRoot + "/voice/index.json";
      })
    );

    /* ---- derivePackRoot ---- */
    eq("derivePackRoot 契约示例", V.derivePackRoot("assets/characters/doubao/voice/index.json"), "assets/characters/doubao");
    eq(
      "derivePackRoot deepseek 示例",
      V.derivePackRoot("assets/characters/deepseek/voice/index.json"),
      "assets/characters/deepseek"
    );
    eq("derivePackRoot 非该后缀返回 null", V.derivePackRoot("assets/characters/deepseek/spine/index.json"), null);
    eq("derivePackRoot 裸 voice/index.json 返回 null", V.derivePackRoot("voice/index.json"), null);
    eq("derivePackRoot 绝对路径返回 null", V.derivePackRoot("/abs/voice/index.json"), null);
    eq("derivePackRoot 含 .. 返回 null", V.derivePackRoot("assets/../x/voice/index.json"), null);
    eq("derivePackRoot 非字符串返回 null", V.derivePackRoot(null), null);
    eq("derivePackRoot 带查询串返回 null", V.derivePackRoot("assets/x/voice/index.json?x=1"), null);
    eq("derivePackRoot 段非法返回 null", V.derivePackRoot("assets/char%acters/voice/index.json"), null);
    eq("derivePackRoot 末尾斜杠也接受", V.derivePackRoot("assets/x/voice/index.json/"), "assets/x");
    ok(
      "derivePackRoot 结果不含 /voice 且不以斜杠结尾",
      (function () {
        var p = V.derivePackRoot("assets/characters/doubao/voice/index.json");
        return typeof p === "string" && p.indexOf("/voice") < 0 && p.charAt(p.length - 1) !== "/";
      })()
    );
  }

  function normDeg(deg) {
    var d = deg % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return d;
  }

  /* ------------------------------------------------------------------ *
   * 运行与渲染
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * P2：deform 形变求值（T24）
   * ------------------------------------------------------------------ */
  function runDeform() {
    var ATLAS = "tex.png\nsize: 256, 256\nmRigid\nbounds: 0, 0, 32, 32\nmWeight\nbounds: 32, 0, 32, 32\nmReg\nbounds: 64, 0, 32, 32\n";
    var atlasRes = core.parseAtlas(ATLAS);
    ok("deform 夹具 atlas 解析", atlasRes.ok, atlasRes.issues);
    var atlas = atlasRes.value;

    var RIGID = {
      skeleton: { spine: "4.2.22" },
      bones: [{ name: "root" }, { name: "A", parent: "root", rotation: 30, length: 100 }],
      slots: [{ name: "s", bone: "A", attachment: "m" }],
      skins: [
        {
          name: "default",
          attachments: {
            s: { m: { type: "mesh", path: "mRigid", uvs: [0, 0, 1, 0, 1, 1, 0, 1], vertices: [0, 0, 40, 0, 40, 40, 0, 40], triangles: [0, 1, 2, 0, 2, 3], hull: 4 } },
          },
        },
      ],
      animations: {
        lind: {
          attachments: {
            default: {
              s: {
                m: {
                  deform: [
                    { time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] },
                    { time: 1, offset: 0, vertices: [10, 0, 0, -10, -10, 0, 0, 10] },
                  ],
                },
              },
            },
          },
        },
        stepd: {
          attachments: {
            default: { s: { m: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0], curve: "stepped" }, { time: 1, offset: 0, vertices: [8, 0, 0, -8, -8, 0, 0, 8] }] } } },
          },
        },
        bezd: {
          attachments: {
            default: { s: { m: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0], curve: [0.3, 0.5, 0.7, 0.9] }, { time: 1, offset: 0, vertices: [10, 0, 0, -10, -10, 0, 0, 10] }] } } },
          },
        },
        late: { attachments: { default: { s: { m: { deform: [{ time: 0.5, offset: 0, vertices: [4, 0, 0, -4, -4, 0, 0, 4] }] } } } } },
        partial: { attachments: { default: { s: { m: { deform: [{ time: 0, offset: 2, vertices: [5, -5] }] } } } } },
        legacy: { deform: { s: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] }, { time: 1, offset: 0, vertices: [3, 0, 0, -3, -3, 0, 0, 3] }] } },
      },
    };
    var rigidRes = core.parseModel(RIGID, atlas, { skin: "default" });
    ok("含 deform 的模型解析成功", rigidRes.ok, rigidRes.issues);
    if (!rigidRes.ok) return;
    var rm = rigidRes.value;
    var ranim = rm.animations.get("lind");
    eq("deform 轨道已解析", ranim.deform.length, 1);
    eq("anim.hasDeform 标记", ranim.hasDeform, true);
    eq("capabilities：deform 已求值不再标 unsupported", rm.capabilities.unsupported.deform, false);
    var ratt = null;
    rm.attachments.forEach(function (a) {
      if (a.id === "default/s/m") ratt = a;
    });
    ok("拿到 mesh 附件", !!ratt);
    eq("刚性 mesh 偏移长度 = 2×顶点数", core.deformOffsetsLength(ratt), 8);

    var p0 = core.evalPose(rm, { animation: "lind", time: 0, skin: "default" });
    var pHalf = core.evalPose(rm, { animation: "lind", time: 0.5, skin: "default" });
    var pFull = core.evalPose(rm, { animation: "lind", time: 1, skin: "default" });
    var pAfter = core.evalPose(rm, { animation: "lind", time: 2.5, skin: "default" });
    ok("首 key 处偏移 = 0（全零数组）", Array.from(p0.deform[0]).every(function (v) { return Math.abs(v) < 1e-12; }));
    nearArray("线性中点 = 两端平均", Array.from(pHalf.deform[0]), [5, 0, 0, -5, -5, 0, 0, 5], 1e-9);
    nearArray("末 key 取末值", Array.from(pFull.deform[0]), [10, 0, 0, -10, -10, 0, 0, 10], 1e-9);
    nearArray("末 key 之后保持末值", Array.from(pAfter.deform[0]), [10, 0, 0, -10, -10, 0, 0, 10], 1e-9);

    var pLate = core.evalPose(rm, { animation: "late", time: 0.25, skin: "default" });
    ok("首 key 之前无偏移（deform 未定义）", pLate.deform[0] === undefined);
    var pLate1 = core.evalPose(rm, { animation: "late", time: 0.75, skin: "default" });
    nearArray("首 key 之后单 key 恒定", Array.from(pLate1.deform[0]), [4, 0, 0, -4, -4, 0, 0, 4], 1e-9);

    var pStep = core.evalPose(rm, { animation: "stepd", time: 0.9, skin: "default" });
    ok("stepped 段取前值（全零）", Array.from(pStep.deform[0]).every(function (v) { return Math.abs(v) < 1e-12; }));

    var bezTrack = rm.animations.get("bezd").deform[0];
    var bezPct = core.sampleDeformAt(bezTrack, 0.5);
    ok("bezier 段采样可用", !!bezPct);
    ok("bezier 百分比 ≠ 线性 0.5", Math.abs(bezPct[0] - 5) > 1e-3, "v0=" + bezPct[0]);
    var pBez = core.evalPose(rm, { animation: "bezd", time: 0.5, skin: "default" });
    near("evalPose 与 sampleDeformAt 一致（bezier）", pBez.deform[0][0], bezPct[0], 1e-12);

    var pPartial = core.evalPose(rm, { animation: "partial", time: 0, skin: "default" });
    nearArray("offset 起始位置生效", Array.from(pPartial.deform[0]), [0, 0, 5, -5, 0, 0, 0, 0], 1e-12);

    var pLegacy = core.evalPose(rm, { animation: "legacy", time: 1, skin: "default" });
    nearArray("旧式 deform.<slot> 轨道已求值", Array.from(pLegacy.deform[0]), [3, 0, 0, -3, -3, 0, 0, 3], 1e-9);

    /* buildGeometry 必须把偏移喂给 skinMesh */
    var itemsNoDeform = core.buildGeometry(rm, core.evalPose(rm, { animation: "lind", time: 0, skin: "default" }), {});
    var itemsHalf = core.buildGeometry(rm, pHalf, {});
    var manual = core.skinMesh(ratt, rm.slots[0].boneIndex, pHalf.world, pHalf.deform[0]);
    nearArray("buildGeometry 顶点 = skinMesh(world, deform)", Array.from(itemsHalf[0].worldXY), Array.from(manual), 1e-9);
    ok("形变确实改变顶点", Math.hypot(itemsHalf[0].worldXY[0] - itemsNoDeform[0].worldXY[0], itemsHalf[0].worldXY[1] - itemsNoDeform[0].worldXY[1]) > 1);
    var manualNoDeform = core.skinMesh(ratt, rm.slots[0].boneIndex, pHalf.world);
    ok("不传 deform 时结果与无形变一致", Math.hypot(manualNoDeform[0] - itemsNoDeform[0].worldXY[0], manualNoDeform[1] - itemsNoDeform[0].worldXY[1]) < 1e-9);

    /* 加权 mesh：偏移按 influence 计（每 influence 2 个数） */
    var WEIGHT = {
      skeleton: { spine: "4.2.22" },
      bones: [{ name: "root" }, { name: "A", parent: "root", rotation: 30, length: 100 }, { name: "B", parent: "root", x: 0, y: 50 }],
      slots: [{ name: "s", bone: "A", attachment: "w" }],
      skins: [
        {
          name: "default",
          attachments: {
            s: {
              w: {
                type: "mesh",
                path: "mWeight",
                uvs: [0, 0, 1, 0, 1, 1, 0, 1],
                vertices: [1, 1, 0, 0, 1, 1, 2, 40, 0, 1, 2, 1, 0, 40, 0.5, 2, 40, 40, 0.5, 1, 2, 0, 0, 1],
                triangles: [0, 1, 2, 0, 2, 3],
                hull: 4,
              },
            },
          },
        },
      ],
      animations: {
        wd: {
          attachments: {
            default: {
              s: {
                w: {
                  deform: [
                    { time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                    { time: 1, offset: 0, vertices: [5, 0, 0, -5, 3, 3, -3, -3, 2, -2] },
                  ],
                },
              },
            },
          },
        },
      },
    };
    var wRes = core.parseModel(WEIGHT, atlas, { skin: "default" });
    ok("加权 mesh 模型解析成功", wRes.ok, wRes.issues);
    if (wRes.ok) {
      var wm = wRes.value;
      var watt = null;
      wm.attachments.forEach(function (a) {
        if (a.id === "default/s/w") watt = a;
      });
      ok("加权 mesh 被识别", !!watt && watt.weighted === true, "influences=" + (watt && watt.influences ? watt.influences.length : "-"));
      eq("加权偏移长度 = 2×influence 数（5）", core.deformOffsetsLength(watt), 10);
      var wp = core.evalPose(wm, { animation: "wd", time: 1, skin: "default" });
      eq("加权 deform 长度", wp.deform[0].length, 10);
      var wManual = core.skinMesh(watt, wm.slots[0].boneIndex, wp.world, wp.deform[0]);
      var wItem = core.buildGeometry(wm, wp, {})[0];
      nearArray("加权 mesh 顶点 = skinMesh(offsets)", Array.from(wItem.worldXY), Array.from(wManual), 1e-9);
      var wNo = core.buildGeometry(wm, core.evalPose(wm, { animation: "wd", time: 0, skin: "default" }), {})[0];
      ok("加权形变改变顶点", Math.hypot(wItem.worldXY[0] - wNo.worldXY[0], wItem.worldXY[1] - wNo.worldXY[1]) > 0.5);
    }

    /* region 角点顺序（官方 offset[0..7] = 我们 localXY 的 BL/TL/TR/BR） */
    var REGION = {
      skeleton: { spine: "4.2.22" },
      bones: [{ name: "root" }, { name: "A", parent: "root", length: 100 }],
      slots: [{ name: "s", bone: "A", attachment: "r" }],
      skins: [{ name: "default", attachments: { s: { r: { type: "region", path: "mReg", x: 0, y: 0, width: 40, height: 40 } } } }],
      animations: {
        rd: {
          attachments: {
            default: { s: { r: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] }, { time: 1, offset: 0, vertices: [6, 0, 0, -4, -6, 0, 0, 4] }] } } },
          },
        },
      },
    };
    var rRes = core.parseModel(REGION, atlas, { skin: "default" });
    ok("region 形变模型解析成功", rRes.ok, rRes.issues);
    if (rRes.ok) {
      var regm = rRes.value;
      var setupItem = core.buildGeometry(regm, core.evalPose(regm, { time: 0 }), {})[0];
      var defItem = core.buildGeometry(regm, core.evalPose(regm, { animation: "rd", time: 1, skin: "default" }), {})[0];
      var dm = defItem.worldXY;
      /* A 骨 rotation 0、scale 1 → 世界位移 = 偏移本身 */
      near("角点 0（BL）位移 x", dm[0] - setupItem.worldXY[0], 6, 1e-9);
      near("角点 1（TL）位移 y", dm[3] - setupItem.worldXY[3], -4, 1e-9);
      near("角点 2（TR）位移 x", dm[4] - setupItem.worldXY[4], -6, 1e-9);
      near("角点 3（BR）位移 y", dm[7] - setupItem.worldXY[7], 4, 1e-9);
    }

    /* deform 与 IK 叠加：IK 先解算姿态，形变在同一 world 矩阵上叠加 */
    var IKD = {
      skeleton: { spine: "4.2.22" },
      bones: [
        { name: "root" },
        { name: "P", parent: "root", rotation: 0, length: 100 },
        { name: "C", parent: "P", x: 100, rotation: 0, length: 100 },
        { name: "T1", parent: "root", x: 100, y: 100 },
      ],
      slots: [{ name: "s", bone: "C", attachment: "m" }],
      skins: [{ name: "default", attachments: { s: { m: { type: "mesh", path: "mRigid", uvs: [0, 0, 1, 0, 1, 1, 0, 1], vertices: [0, 0, 40, 0, 40, 40, 0, 40], triangles: [0, 1, 2, 0, 2, 3], hull: 4 } } } }],
      ik: [{ name: "ik-a", order: 0, bones: ["P", "C"], target: "T1", mix: 1, bendPositive: true }],
      animations: {
        ikd: {
          attachments: {
            default: { s: { m: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] }, { time: 1, offset: 0, vertices: [6, 0, 0, -6, -6, 0, 0, 6] }] } } },
          },
        },
      },
    };
    var ikRes = core.parseModel(IKD, atlas, { skin: "default" });
    ok("IK+deform 模型解析成功", ikRes.ok, ikRes.issues);
    if (ikRes.ok) {
      var ikm = ikRes.value;
      var ikPose = core.evalPose(ikm, { animation: "ikd", time: 1, skin: "default" });
      var cIdx = ikm.boneIndex.get("C");
      ok("IK 已解算（C 局部角非 0）", Math.abs(ikPose.applied[cIdx].rotation) > 1, "rot=" + ikPose.applied[cIdx].rotation);
      ok("IK 场景下 deform 仍有偏移", !!ikPose.deform[0] && Math.abs(ikPose.deform[0][0] - 6) < 1e-9);
      var ikAtt = null;
      ikm.attachments.forEach(function (a) {
        if (a.id === "default/s/m") ikAtt = a;
      });
      var ikItem = core.buildGeometry(ikm, ikPose, {})[0];
      var ikManual = core.skinMesh(ikAtt, ikm.slots[0].boneIndex, ikPose.world, ikPose.deform[0]);
      nearArray("IK+deform 顶点 = skinMesh(IK world, offsets)", Array.from(ikItem.worldXY), Array.from(ikManual), 1e-9);
      var ikNoDeform = core.skinMesh(ikAtt, ikm.slots[0].boneIndex, ikPose.world);
      ok("IK 场景形变确实改变顶点", Math.hypot(ikItem.worldXY[0] - ikNoDeform[0], ikItem.worldXY[1] - ikNoDeform[1]) > 1);
    }

    /* 诚实性：transform / path 仍必须告警 */
    var TF = {
      skeleton: { spine: "4.2.22" },
      bones: [{ name: "root" }],
      slots: [],
      skins: [{ name: "default", attachments: {} }],
      transform: [{ name: "tc", bone: "root", target: "root", mixRotate: 0.5 }],
      animations: { t: { transform: { tc: [{ time: 0, mixRotate: 0.5 }] } } },
    };
    var tfRes = core.parseModel(TF, atlas, { skin: "default" });
    ok(
      "transform 动画仍报 unsupported（诚实）",
      tfRes.issues.some(function (i) {
        return i.code === "animation.transform.unsupported";
      }),
      tfRes.issues.map(function (i) {
        return i.code;
      })
    );
    ok(
      "模型级 transform/path 约束仍报 unsupported",
      tfRes.issues.some(function (i) {
        return i.code === "model.transform.unsupported";
      })
    );
  }

  function run() {
    if (!core) {
      result.failures.push({ case: "(global)", name: "SpineCore 未加载", expected: "存在", actual: "缺失", detail: "" });
      result.failed++;
      result.total++;
      return result;
    }
    if (!fixtures) {
      result.failures.push({ case: "(global)", name: "SpineFixtures 未加载", expected: "存在", actual: "缺失", detail: "" });
      result.failed++;
      result.total++;
      return result;
    }
    Object.keys(fixtures).forEach(function (id) {
      try {
        runFixture(fixtures[id]);
      } catch (err) {
        record(false, "fixture 执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
      }
    });
    try {
      runExtra();
    } catch (err) {
      record(false, "额外断言执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
    }
    try {
      runDeform();
    } catch (err) {
      record(false, "deform 断言执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
    }
    try {
      runBundle();
    } catch (err) {
      record(false, "bundle 断言执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
    }
    try {
      runVoice();
    } catch (err) {
      record(false, "voice 断言执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
    }
    result.finishedAt = new Date().toISOString();
    return result;
  }

  function render(res) {
    if (typeof document === "undefined") return;
    var summary = document.getElementById("summary");
    var list = document.getElementById("results");
    var okAll = res.failed === 0;
    if (summary) {
      summary.textContent =
        (okAll ? "PASS" : "FAIL") +
        " — " +
        res.passed +
        " passed / " +
        res.failed +
        " failed / " +
        res.total +
        " total";
      summary.className = okAll ? "pass" : "fail";
    }
    if (list) {
      var header = document.createElement("p");
      header.textContent =
        "用例 " +
        Object.keys(res.cases).length +
        " 组；失败 " +
        res.failed +
        " 条" +
        (res.failed ? "（期望/实际见下）" : "");
      list.appendChild(header);
      if (res.failures.length) {
        var ul = document.createElement("ul");
        ul.className = "failures";
        res.failures.forEach(function (f) {
          var li = document.createElement("li");
          li.textContent =
            "[" + f.case + "] " + f.name + " — 期望 " + fmt(f.expected) + "，实际 " + fmt(f.actual) + (f.detail ? "（" + f.detail + "）" : "");
          ul.appendChild(li);
        });
        list.appendChild(ul);
      } else {
        var p = document.createElement("p");
        p.className = "pass";
        p.textContent = "全部通过。";
        list.appendChild(p);
      }
    }
  }

  var res = run();
  if (typeof window !== "undefined") window.__selftestResult = res;
  else global.__selftestResult = res;
  if (typeof document !== "undefined" && document.readyState !== "loading") render(res);
  else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      render(res);
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
