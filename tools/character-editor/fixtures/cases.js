/*
 * fixtures/cases.js —— 「内置人物包管理器」手写 fixture 源码（可入库）。
 *
 * 结构（契约 A9）：{ id, label, group, example, json, atlasText, textureSpec, expected }。
 * - textureSpec：{ width, height, cells:[{rect,color,label}] }；多 page 时为
 *   [{ name, width, height, cells }]，name 与 atlas 页名对应。
 * - expected 中的数值由官方 spine-core 4.2.120 运行时逐项计算（不是本模块自证），
 *   用于 selftest 断言骨 world 矩阵 / 蒙皮顶点 / atlas 像素映射 / 权重配色 / 命中。
 * - 不含任何 png 或生成产物；棋盘由 app/selftest 在内存 canvas 上按 textureSpec 绘制。
 * - group：basic / atlas / ik / fk / diagnostics / degenerate；example=true 供「示例 ▾」。
 *
 * 覆盖契约 A9 ①–⑧，另含退化/非法输入用例。
 */
(function (global) {
  "use strict";
  var cases = {
  "region-transform": {
    "id": "region-transform",
    "label": "① region：尺寸≠图集 + 旋转/缩放 + 父负缩放",
    "group": "basic",
    "example": true,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root",
          "rotation": 30
        },
        {
          "name": "mirror",
          "parent": "root",
          "x": 50,
          "y": 10,
          "rotation": -20,
          "scaleX": -1,
          "scaleY": 1.5
        }
      ],
      "slots": [
        {
          "name": "body",
          "bone": "mirror",
          "attachment": "region-big"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "body": {
              "region-big": {
                "path": "big",
                "width": 80,
                "height": 60,
                "x": 5,
                "y": -3,
                "rotation": 45,
                "scaleX": 2,
                "scaleY": 0.5
              }
            }
          }
        }
      ]
    },
    "atlasText": "case1.png\nsize: 256, 128\nfilter: Linear, Linear\nbig\nbounds: 10, 20, 40, 30\n",
    "textureSpec": {
      "width": 256,
      "height": 128,
      "cells": [
        {
          "rect": [
            0,
            0,
            128,
            64
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            128,
            0,
            128,
            64
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            64,
            128,
            64
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            128,
            64,
            128,
            64
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 2,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 0
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              0.8660253999169214,
              0.5000000066987363,
              -0.500000026794945,
              0.8660253883143694,
              0,
              0
            ],
            "mirror": [
              -0.9848077594377915,
              -0.1736481841744109,
              -0.2604723329143937,
              1.4772116064481895,
              38.30126972789662,
              33.66025421808051
            ]
          },
          "meshes": [
            {
              "slot": "body",
              "attachment": "region-big",
              "vertices": [
                96.9195913501186,
                -62.89032227271797,
                112.28506511101946,
                -27.87029206442827,
                -28.6022954912169,
                119.61107922844575,
                -43.967765495374316,
                84.5910496825713
              ]
            }
          ]
        }
      ],
      "sources": [
        {
          "slot": "body",
          "attachment": "region-big",
          "corner": 0,
          "uv": [
            0,
            1
          ],
          "x": 10,
          "y": 50
        },
        {
          "slot": "body",
          "attachment": "region-big",
          "corner": 1,
          "uv": [
            0,
            0
          ],
          "x": 10,
          "y": 20
        },
        {
          "slot": "body",
          "attachment": "region-big",
          "corner": 2,
          "uv": [
            1,
            0
          ],
          "x": 50,
          "y": 20
        },
        {
          "slot": "body",
          "attachment": "region-big",
          "corner": 3,
          "uv": [
            1,
            1
          ],
          "x": 50,
          "y": 50
        }
      ],
      "bounds": {
        "minX": -43.967765495374316,
        "minY": -62.89032227271797,
        "maxX": 112.28506511101946,
        "maxY": 119.61107922844575
      }
    }
  },
  "rigid-mesh-concave": {
    "id": "rigid-mesh-concave",
    "label": "② 刚性 mesh：凹五边形 + hull/edges + uv 刻意错位",
    "group": "basic",
    "example": true,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root",
          "x": 10,
          "y": 20,
          "rotation": 15
        },
        {
          "name": "arm",
          "parent": "root",
          "x": 30,
          "y": -5,
          "rotation": -40
        }
      ],
      "slots": [
        {
          "name": "shape",
          "bone": "arm",
          "attachment": "shape"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "shape": {
              "shape": {
                "type": "mesh",
                "width": 100,
                "height": 50,
                "uvs": [
                  0,
                  1,
                  1,
                  1,
                  1,
                  0,
                  0.5,
                  0.5,
                  0,
                  0
                ],
                "vertices": [
                  0,
                  0,
                  100,
                  0,
                  100,
                  40,
                  60,
                  10,
                  0,
                  40
                ],
                "triangles": [
                  0,
                  1,
                  2,
                  0,
                  2,
                  3,
                  0,
                  3,
                  4
                ],
                "hull": 5,
                "edges": [
                  0,
                  2,
                  2,
                  4,
                  4,
                  6,
                  6,
                  8,
                  8,
                  0
                ]
              }
            }
          }
        }
      ]
    },
    "atlasText": "case2.png\nsize: 256, 256\nshape\nbounds: 5, 6, 100, 50\n",
    "textureSpec": {
      "width": 256,
      "height": 256,
      "cells": [
        {
          "rect": [
            0,
            0,
            128,
            128
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            128,
            0,
            128,
            128
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            128,
            128,
            128
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            128,
            128,
            128,
            128
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 2,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 0
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              0.9659258252880811,
              0.2588190488382555,
              -0.2588190712526642,
              0.9659258192821581,
              10,
              20
            ],
            "arm": [
              0.9063077987202153,
              -0.42261826372210143,
              0.42261822938123494,
              0.9063077895186074,
              40.27187011490575,
              22.934942368736873
            ]
          },
          "meshes": [
            {
              "slot": "shape",
              "attachment": "shape",
              "vertices": [
                40.27187011490575,
                22.934942368736873,
                130.90264998692726,
                -19.32688400347327,
                147.8073791621767,
                16.92542757727102,
                98.87652033193102,
                6.640924440596862,
                57.17659929015515,
                59.18725394948116
              ]
            }
          ]
        }
      ],
      "sources": [
        {
          "slot": "shape",
          "attachment": "shape",
          "corner": 0,
          "uv": [
            0,
            1
          ],
          "x": 5,
          "y": 56
        },
        {
          "slot": "shape",
          "attachment": "shape",
          "corner": 3,
          "uv": [
            0.5,
            0.5
          ],
          "x": 55,
          "y": 31
        },
        {
          "slot": "shape",
          "attachment": "shape",
          "corner": 4,
          "uv": [
            0,
            0
          ],
          "x": 5,
          "y": 6
        }
      ],
      "bounds": {
        "minX": 40.27187011490575,
        "minY": -19.32688400347327,
        "maxX": 147.8073791621767,
        "maxY": 59.18725394948116
      },
      "hits": [
        {
          "point": [
            40.27187011490575,
            22.934942368736873
          ],
          "expect": "shape"
        },
        {
          "point": [
            98.26580693235357,
            28.993262868190023
          ],
          "expect": null
        }
      ]
    }
  },
  "weighted-mesh": {
    "id": "weighted-mesh",
    "label": "③ 加权 mesh：1/2 influence、0/0.5/1 权重、权重图配色",
    "group": "basic",
    "example": true,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root",
          "x": 10,
          "y": 20,
          "rotation": 15
        },
        {
          "name": "A",
          "parent": "root",
          "x": 100,
          "y": 0,
          "rotation": 30
        },
        {
          "name": "B",
          "parent": "root",
          "x": 0,
          "y": 80,
          "rotation": -25
        }
      ],
      "slots": [
        {
          "name": "skin",
          "bone": "A",
          "attachment": "wmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "skin": {
              "wmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  1,
                  1,
                  0,
                  1
                ],
                "vertices": [
                  1,
                  1,
                  0,
                  0,
                  1,
                  2,
                  1,
                  50,
                  0,
                  0.5,
                  2,
                  0,
                  50,
                  0.5,
                  1,
                  2,
                  0,
                  0,
                  1,
                  2,
                  1,
                  20,
                  10,
                  0.25,
                  2,
                  -10,
                  30,
                  0.75
                ],
                "triangles": [
                  0,
                  1,
                  2,
                  0,
                  2,
                  3
                ],
                "hull": 4
              }
            }
          }
        }
      ]
    },
    "atlasText": "case3.png\nsize: 128, 128\nwmesh\nbounds: 0, 0, 64, 64\n",
    "textureSpec": {
      "width": 128,
      "height": 128,
      "cells": [
        {
          "rect": [
            0,
            0,
            64,
            64
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            64,
            0,
            64,
            64
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            64,
            64,
            64
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            64,
            64,
            64,
            64
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 3,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 1,
        "ik": 0
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              0.9659258252880811,
              0.2588190488382555,
              -0.2588190712526642,
              0.9659258192821581,
              10,
              20
            ],
            "A": [
              0.7071067617750999,
              0.7071067863878289,
              -0.7071068252107229,
              0.7071067513725364,
              106.59258252880811,
              45.881904883825555
            ],
            "B": [
              0.9848077620372216,
              -0.17364817766789156,
              0.17364813703918527,
              0.9848077511507921,
              -10.705525700213133,
              97.27406554257266
            ]
          },
          "meshes": [
            {
              "slot": "skin",
              "attachment": "wmesh",
              "vertices": [
                106.59258252880811,
                45.881904883825555,
                69.96240088465463,
                113.87584865166463,
                -10.705525700213133,
                97.27406554257266,
                16.907792970993377,
                113.18986192165836
              ]
            }
          ]
        }
      ],
      "sources": [
        {
          "slot": "skin",
          "attachment": "wmesh",
          "corner": 0,
          "uv": [
            0,
            0
          ],
          "x": 0,
          "y": 0
        },
        {
          "slot": "skin",
          "attachment": "wmesh",
          "corner": 2,
          "uv": [
            1,
            1
          ],
          "x": 64,
          "y": 64
        }
      ],
      "weights": [
        {
          "slot": "skin",
          "attachment": "wmesh",
          "palette": {
            "1": [
              1,
              0,
              0
            ],
            "2": [
              0,
              1,
              0
            ]
          },
          "colors": [
            [
              1,
              0,
              0
            ],
            [
              0.5,
              0.5,
              0
            ],
            [
              0,
              1,
              0
            ],
            [
              0.25,
              0.75,
              0
            ]
          ]
        }
      ],
      "bounds": {
        "minX": -10.705525700213133,
        "minY": 45.881904883825555,
        "maxX": 106.59258252880811,
        "maxY": 113.87584865166463
      }
    }
  },
  "atlas-rotations-trim": {
    "id": "atlas-rotations-trim",
    "label": "④ atlas：0/90/180/270 + trim + 多 page",
    "group": "atlas",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s-flat",
          "bone": "root",
          "attachment": "a-flat"
        },
        {
          "name": "s-rot90",
          "bone": "root",
          "attachment": "a-rot90"
        },
        {
          "name": "s-rot180",
          "bone": "root",
          "attachment": "a-rot180"
        },
        {
          "name": "s-rot270",
          "bone": "root",
          "attachment": "a-rot270"
        },
        {
          "name": "s-p2",
          "bone": "root",
          "attachment": "a-p2"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s-flat": {
              "a-flat": {
                "path": "flat",
                "width": 64,
                "height": 64
              }
            },
            "s-rot90": {
              "a-rot90": {
                "path": "rot90",
                "width": 60,
                "height": 30
              }
            },
            "s-rot180": {
              "a-rot180": {
                "path": "rot180",
                "type": "mesh",
                "uvs": [
                  0.05,
                  0.8666667,
                  0.05,
                  0.2,
                  0.8,
                  0.2,
                  0.8,
                  0.8666667
                ],
                "vertices": [
                  -20,
                  -10,
                  -20,
                  10,
                  20,
                  10,
                  20,
                  -10
                ],
                "triangles": [
                  0,
                  1,
                  2,
                  0,
                  2,
                  3
                ],
                "hull": 4
              }
            },
            "s-rot270": {
              "a-rot270": {
                "path": "rot270",
                "type": "mesh",
                "uvs": [
                  0.06,
                  0.86,
                  0.06,
                  0.14,
                  0.54,
                  0.14,
                  0.54,
                  0.86
                ],
                "vertices": [
                  -25,
                  -18,
                  25,
                  -18,
                  25,
                  18,
                  -25,
                  18
                ],
                "triangles": [
                  0,
                  1,
                  2,
                  0,
                  2,
                  3
                ],
                "hull": 4
              }
            },
            "s-p2": {
              "a-p2": {
                "path": "p2",
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ]
    },
    "atlasText": "case4-a.png\nsize: 128, 128\nflat\nbounds: 0, 0, 64, 64\nrot90\nbounds: 100, 10, 40, 20\nrotate: 90\noffsets: 5, 6, 60, 30\nrot180\nbounds: 10, 80, 30, 20\nrotate: 180\noffsets: 2, 4, 40, 30\nrot270\nbounds: 60, 60, 24, 36\nrotate: 270\noffsets: 3, 7, 50, 50\n\ncase4-b.png\nsize: 64, 64\np2\nbounds: 5, 5, 16, 16\n",
    "textureSpec": [
      {
        "name": "case4-a.png",
        "width": 128,
        "height": 128,
        "cells": [
          {
            "rect": [
              0,
              0,
              64,
              64
            ],
            "color": "#e5484d",
            "label": "左上红"
          },
          {
            "rect": [
              64,
              0,
              64,
              64
            ],
            "color": "#46a758",
            "label": "右上绿"
          },
          {
            "rect": [
              0,
              64,
              64,
              64
            ],
            "color": "#3e63dd",
            "label": "左下蓝"
          },
          {
            "rect": [
              64,
              64,
              64,
              64
            ],
            "color": "#f5d90a",
            "label": "右下黄"
          }
        ]
      },
      {
        "name": "case4-b.png",
        "width": 64,
        "height": 64,
        "cells": [
          {
            "rect": [
              0,
              0,
              32,
              32
            ],
            "color": "#e5484d",
            "label": "左上红"
          },
          {
            "rect": [
              32,
              0,
              32,
              32
            ],
            "color": "#46a758",
            "label": "右上绿"
          },
          {
            "rect": [
              0,
              32,
              32,
              32
            ],
            "color": "#3e63dd",
            "label": "左下蓝"
          },
          {
            "rect": [
              32,
              32,
              32,
              32
            ],
            "color": "#f5d90a",
            "label": "右下黄"
          }
        ]
      }
    ],
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 1,
        "slots": 5,
        "meshes": 2,
        "weightedMeshes": 0,
        "ik": 0
      },
      "atlas": {
        "pages": [
          {
            "name": "case4-a.png",
            "width": 128,
            "height": 128
          },
          {
            "name": "case4-b.png",
            "width": 64,
            "height": 64
          }
        ],
        "regions": [
          {
            "name": "flat",
            "pageIndex": 0,
            "x": 0,
            "y": 0,
            "w": 64,
            "h": 64,
            "rotate": 0,
            "offsetX": 0,
            "offsetY": 0,
            "originalW": 64,
            "originalH": 64
          },
          {
            "name": "rot90",
            "pageIndex": 0,
            "x": 100,
            "y": 10,
            "w": 40,
            "h": 20,
            "rotate": 90,
            "offsetX": 5,
            "offsetY": 6,
            "originalW": 60,
            "originalH": 30
          },
          {
            "name": "rot180",
            "pageIndex": 0,
            "x": 10,
            "y": 80,
            "w": 30,
            "h": 20,
            "rotate": 180,
            "offsetX": 2,
            "offsetY": 4,
            "originalW": 40,
            "originalH": 30
          },
          {
            "name": "rot270",
            "pageIndex": 0,
            "x": 60,
            "y": 60,
            "w": 24,
            "h": 36,
            "rotate": 270,
            "offsetX": 3,
            "offsetY": 7,
            "originalW": 50,
            "originalH": 50
          },
          {
            "name": "p2",
            "pageIndex": 1,
            "x": 5,
            "y": 5,
            "w": 16,
            "h": 16,
            "rotate": 0,
            "offsetX": 0,
            "offsetY": 0,
            "originalW": 16,
            "originalH": 16
          }
        ]
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "s-flat",
              "attachment": "a-flat",
              "vertices": [
                -31.999999257436695,
                -31.999999999999993,
                -32.00000074256331,
                31.999999999999993,
                31.999999257436695,
                31.999999999999993,
                32.00000074256331,
                -31.999999999999993
              ]
            },
            {
              "slot": "s-rot90",
              "attachment": "a-rot90",
              "vertices": [
                -24.99999979115407,
                -8.999999999999998,
                -25.000000255256136,
                10.999999999999998,
                14.999999744743864,
                10.999999999999998,
                15.00000020884593,
                -8.999999999999998
              ]
            },
            {
              "slot": "s-rot180",
              "attachment": "a-rot180",
              "vertices": [
                -19.999999767948967,
                -9.999999999999998,
                -20.000000232051033,
                9.999999999999998,
                19.999999767948967,
                9.999999999999998,
                20.000000232051033,
                -9.999999999999998
              ]
            },
            {
              "slot": "s-rot270",
              "attachment": "a-rot270",
              "vertices": [
                -24.99999958230814,
                -17.999999999999996,
                25.00000041769186,
                -17.999999999999996,
                24.99999958230814,
                17.999999999999996,
                -25.00000041769186,
                17.999999999999996
              ]
            },
            {
              "slot": "s-p2",
              "attachment": "a-p2",
              "vertices": [
                -7.999999814359174,
                -7.999999999999998,
                -8.000000185640827,
                7.999999999999998,
                7.999999814359174,
                7.999999999999998,
                8.000000185640827,
                -7.999999999999998
              ]
            }
          ]
        }
      ],
      "sources": [
        {
          "slot": "s-flat",
          "attachment": "a-flat",
          "corner": 0,
          "uv": [
            0,
            1
          ],
          "x": 0,
          "y": 64
        },
        {
          "slot": "s-flat",
          "attachment": "a-flat",
          "corner": 2,
          "uv": [
            1,
            0
          ],
          "x": 64,
          "y": 0
        },
        {
          "slot": "s-rot90",
          "attachment": "a-rot90",
          "corner": 0,
          "uv": [
            0.08333333333333333,
            0.8
          ],
          "x": 120,
          "y": 50
        },
        {
          "slot": "s-rot90",
          "attachment": "a-rot90",
          "corner": 1,
          "uv": [
            0.08333333333333333,
            0.13333333333333333
          ],
          "x": 100,
          "y": 50
        },
        {
          "slot": "s-rot90",
          "attachment": "a-rot90",
          "corner": 2,
          "uv": [
            0.75,
            0.13333333333333333
          ],
          "x": 100,
          "y": 10
        },
        {
          "slot": "s-rot90",
          "attachment": "a-rot90",
          "corner": 3,
          "uv": [
            0.75,
            0.8
          ],
          "x": 120,
          "y": 10
        },
        {
          "slot": "s-rot180",
          "attachment": "a-rot180",
          "corner": 0,
          "uv": [
            0.05,
            0.8666667
          ],
          "x": 40,
          "y": 80
        },
        {
          "slot": "s-rot180",
          "attachment": "a-rot180",
          "corner": 1,
          "uv": [
            0.05,
            0.2
          ],
          "x": 40,
          "y": 100
        },
        {
          "slot": "s-rot180",
          "attachment": "a-rot180",
          "corner": 2,
          "uv": [
            0.8,
            0.2
          ],
          "x": 10,
          "y": 100
        },
        {
          "slot": "s-rot180",
          "attachment": "a-rot180",
          "corner": 3,
          "uv": [
            0.8,
            0.8666667
          ],
          "x": 10,
          "y": 80
        },
        {
          "slot": "s-rot270",
          "attachment": "a-rot270",
          "corner": 0,
          "uv": [
            0.06,
            0.86
          ],
          "x": 60,
          "y": 60
        },
        {
          "slot": "s-rot270",
          "attachment": "a-rot270",
          "corner": 1,
          "uv": [
            0.06,
            0.14
          ],
          "x": 96,
          "y": 60
        },
        {
          "slot": "s-rot270",
          "attachment": "a-rot270",
          "corner": 2,
          "uv": [
            0.54,
            0.14
          ],
          "x": 96,
          "y": 84
        },
        {
          "slot": "s-rot270",
          "attachment": "a-rot270",
          "corner": 3,
          "uv": [
            0.54,
            0.86
          ],
          "x": 60,
          "y": 84
        },
        {
          "slot": "s-p2",
          "attachment": "a-p2",
          "corner": 0,
          "uv": [
            0,
            1
          ],
          "x": 5,
          "y": 21
        }
      ]
    }
  },
  "ik-one-bone": {
    "id": "ik-one-bone",
    "label": "⑤ 一骨 IK：mix1 + compress",
    "group": "ik",
    "example": true,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "arm",
          "parent": "root",
          "rotation": 30,
          "length": 100
        },
        {
          "name": "target",
          "parent": "root",
          "x": 50,
          "y": 0
        },
        {
          "name": "target-far",
          "parent": "root",
          "x": 150,
          "y": 0
        }
      ],
      "slots": [
        {
          "name": "arm-slot",
          "bone": "arm",
          "attachment": "armtex"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "arm-slot": {
              "armtex": {
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "arm-ik",
          "bones": [
            "arm"
          ],
          "target": "target",
          "mix": 1,
          "compress": true
        }
      ]
    },
    "atlasText": "case5.png\nsize: 64, 64\narmtex\nbounds: 0, 0, 16, 16\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "arm": [
              0.5,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "arm-slot",
              "attachment": "armtex",
              "vertices": [
                -3.9999996287183466,
                -7.9999999999999964,
                -4.000000371281653,
                7.9999999999999964,
                3.9999996287183466,
                7.9999999999999964,
                4.000000371281653,
                -7.9999999999999964
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-one-mix0": {
    "id": "ik-one-mix0",
    "label": "⑤ 一骨 IK：mix0（=FK）",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "arm",
          "parent": "root",
          "rotation": 30,
          "length": 100
        },
        {
          "name": "target",
          "parent": "root",
          "x": 50,
          "y": 0
        },
        {
          "name": "target-far",
          "parent": "root",
          "x": 150,
          "y": 0
        }
      ],
      "slots": [
        {
          "name": "arm-slot",
          "bone": "arm",
          "attachment": "armtex"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "arm-slot": {
              "armtex": {
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "arm-ik",
          "bones": [
            "arm"
          ],
          "target": "target",
          "mix": 0,
          "compress": true
        }
      ]
    },
    "atlasText": "case5.png\nsize: 64, 64\narmtex\nbounds: 0, 0, 16, 16\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "arm": [
              0.8660253883143696,
              0.5000000066987362,
              -0.5000000468911536,
              0.8660253883143691,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "arm-slot",
              "attachment": "armtex",
              "vertices": [
                -2.9282027313857277,
                -10.928203160104843,
                -10.928203481644186,
                2.9282030529250633,
                2.9282027313857277,
                10.928203160104843,
                10.928203481644186,
                -2.9282030529250633
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-one-mix05": {
    "id": "ik-one-mix05",
    "label": "⑤ 一骨 IK：mix0.5",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "arm",
          "parent": "root",
          "rotation": 30,
          "length": 100
        },
        {
          "name": "target",
          "parent": "root",
          "x": 50,
          "y": 0
        },
        {
          "name": "target-far",
          "parent": "root",
          "x": 150,
          "y": 0
        }
      ],
      "slots": [
        {
          "name": "arm-slot",
          "bone": "arm",
          "attachment": "armtex"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "arm-slot": {
              "armtex": {
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "arm-ik",
          "bones": [
            "arm"
          ],
          "target": "target",
          "mix": 0.5,
          "compress": true
        }
      ]
    },
    "atlasText": "case5.png\nsize: 64, 64\narmtex\nbounds: 0, 0, 16, 16\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "arm": [
              0.7244443644616189,
              0.19411428662869157,
              -0.2588190936670726,
              0.9659258192821579,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "arm-slot",
              "attachment": "armtex",
              "vertices": [
                -3.72500216635637,
                -9.280320847286795,
                -7.866107665029531,
                6.174492261227731,
                3.72500216635637,
                9.280320847286795,
                7.866107665029531,
                -6.174492261227731
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-one-stretch": {
    "id": "ik-one-stretch",
    "label": "⑤ 一骨 IK：stretch",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "arm",
          "parent": "root",
          "rotation": 30,
          "length": 100
        },
        {
          "name": "target",
          "parent": "root",
          "x": 50,
          "y": 0
        },
        {
          "name": "target-far",
          "parent": "root",
          "x": 150,
          "y": 0
        }
      ],
      "slots": [
        {
          "name": "arm-slot",
          "bone": "arm",
          "attachment": "armtex"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "arm-slot": {
              "armtex": {
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "arm-ik",
          "bones": [
            "arm"
          ],
          "target": "target-far",
          "mix": 1,
          "stretch": true
        }
      ]
    },
    "atlasText": "case5.png\nsize: 64, 64\narmtex\nbounds: 0, 0, 16, 16\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "arm": [
              1.5,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "arm-slot",
              "attachment": "armtex",
              "vertices": [
                -11.999999628718347,
                -7.9999999999999964,
                -12.000000371281653,
                7.9999999999999964,
                11.999999628718347,
                7.9999999999999964,
                12.000000371281653,
                -7.9999999999999964
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-one-uniform": {
    "id": "ik-one-uniform",
    "label": "⑤ 一骨 IK：compress + uniform",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "arm",
          "parent": "root",
          "rotation": 30,
          "length": 100
        },
        {
          "name": "target",
          "parent": "root",
          "x": 50,
          "y": 0
        },
        {
          "name": "target-far",
          "parent": "root",
          "x": 150,
          "y": 0
        }
      ],
      "slots": [
        {
          "name": "arm-slot",
          "bone": "arm",
          "attachment": "armtex"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "arm-slot": {
              "armtex": {
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "arm-ik",
          "bones": [
            "arm"
          ],
          "target": "target",
          "mix": 1,
          "compress": true,
          "uniform": true
        }
      ]
    },
    "atlasText": "case5.png\nsize: 64, 64\narmtex\nbounds: 0, 0, 16, 16\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "arm": [
              0.5,
              0,
              -2.3205103333142414e-8,
              0.4999999999999998,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "arm-slot",
              "attachment": "armtex",
              "vertices": [
                -3.9999998143591733,
                -3.9999999999999982,
                -4.000000185640826,
                3.9999999999999982,
                3.9999998143591733,
                3.9999999999999982,
                4.000000185640826,
                -3.9999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-one-softness": {
    "id": "ik-one-softness",
    "label": "⑤ 一骨 IK：softness 对一骨无影响",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "arm",
          "parent": "root",
          "rotation": 30,
          "length": 100
        },
        {
          "name": "target",
          "parent": "root",
          "x": 50,
          "y": 0
        },
        {
          "name": "target-far",
          "parent": "root",
          "x": 150,
          "y": 0
        }
      ],
      "slots": [
        {
          "name": "arm-slot",
          "bone": "arm",
          "attachment": "armtex"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "arm-slot": {
              "armtex": {
                "width": 16,
                "height": 16
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "arm-ik",
          "bones": [
            "arm"
          ],
          "target": "target",
          "mix": 1,
          "compress": true,
          "softness": 50
        }
      ]
    },
    "atlasText": "case5.png\nsize: 64, 64\narmtex\nbounds: 0, 0, 16, 16\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "arm": [
              0.5,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ]
          },
          "meshes": [
            {
              "slot": "arm-slot",
              "attachment": "armtex",
              "vertices": [
                -3.9999996287183466,
                -7.9999999999999964,
                -4.000000371281653,
                7.9999999999999964,
                3.9999996287183466,
                7.9999999999999964,
                4.000000371281653,
                -7.9999999999999964
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-bone": {
    "id": "ik-two-bone",
    "label": "⑥ 二骨 IK：mix1 + 正 bend",
    "group": "ik",
    "example": true,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T1",
          "mix": 1,
          "bendPositive": true
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              -4.641020682709709e-8,
              0.9999999999999996,
              -0.9999999999999987,
              -2.3205103493954673e-8,
              100,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                99.99999535897932,
                99.99999999999996,
                99.99999443077519,
                119.99999999999994,
                79.99999535897938,
                99.99999907179583
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-mix0": {
    "id": "ik-two-mix0",
    "label": "⑥ 二骨 IK：mix0（=FK）",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T1",
          "mix": 0
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              1,
              0,
              -6.961530999942724e-8,
              0.9999999999999993,
              100,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                200,
                0,
                220,
                0,
                199.99999814359174,
                19.999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-mix05": {
    "id": "ik-two-mix05",
    "label": "⑥ 二骨 IK：mix0.5",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T1",
          "mix": 0.5
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              0.7071067483695757,
              0.7071067811865472,
              -0.7071068304120042,
              0.7071067647780612,
              100,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                170.71067483695757,
                70.71067811865473,
                184.85280980434908,
                84.85281374238568,
                156.56853790054777,
                84.85281308604623
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-bendneg": {
    "id": "ik-two-bendneg",
    "label": "⑥ 二骨 IK：负 bend",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T1",
          "mix": 1,
          "bendPositive": false
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              -2.3205103493954683e-8,
              0.9999999999999998,
              -0.9999999999999992,
              -2.3205103493954676e-8,
              0,
              0
            ],
            "C": [
              0.9999999999999992,
              2.320510333314241e-8,
              -4.6410206831172615e-8,
              0.999999999999999,
              -0.0000023205103493954685,
              99.99999999999997
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                99.99999767948958,
                100.0000023205103,
                119.99999767948957,
                100.00000278461238,
                99.99999628718338,
                120.00000232051028
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-far": {
    "id": "ik-two-far",
    "label": "⑥ 二骨 IK：远目标（无 stretch）",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T2",
          "mix": 1
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              1,
              0,
              -6.961530999942724e-8,
              0.9999999999999993,
              100,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                200,
                0,
                220,
                0,
                199.99999814359174,
                19.999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-far-stretch": {
    "id": "ik-two-far-stretch",
    "label": "⑥ 二骨 IK：远目标 + stretch",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T2",
          "mix": 1,
          "stretch": true
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1.5,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              1.5,
              0,
              -8.121786166599844e-8,
              0.9999999999999993,
              150,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                300,
                0,
                330,
                0,
                299.99999767948964,
                19.999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-near": {
    "id": "ik-two-near",
    "label": "⑥ 二骨 IK：近目标",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T3",
          "mix": 1
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              0.9114378373136048,
              -0.4114378277661476,
              0.41143778546612936,
              0.9114378373136045,
              0,
              0
            ],
            "C": [
              -0.4114378629055727,
              0.9114378340811967,
              -0.9114377928087247,
              -0.4114378560767495,
              91.14378373136049,
              -41.14378277661476
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                49.99999744080321,
                50.00000063150491,
                41.771240182691756,
                68.22875731312885,
                31.771241775577884,
                41.77124308696974
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-softness-1e-4": {
    "id": "ik-two-softness-1e-4",
    "label": "⑥ 二骨 IK：softness 1e-4",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T2",
          "mix": 1,
          "softness": 0.0001
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              1,
              0,
              -6.961530999942724e-8,
              0.9999999999999993,
              100,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                200,
                0,
                220,
                0,
                199.99999814359174,
                19.999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-softness-50": {
    "id": "ik-two-softness-50",
    "label": "⑥ 二骨 IK：softness 50",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T2",
          "mix": 1,
          "softness": 50
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              1,
              0,
              -6.961530999942724e-8,
              0.9999999999999993,
              100,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                200,
                0,
                220,
                0,
                199.99999814359174,
                19.999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-order-a": {
    "id": "ik-two-order-a",
    "label": "⑥b 两约束 order 0→1",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 0,
          "bones": [
            "P",
            "C"
          ],
          "target": "T1"
        },
        {
          "name": "ik-b",
          "order": 1,
          "bones": [
            "C",
            "D"
          ],
          "target": "T2"
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 2
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              1,
              0,
              -6.961530999942724e-8,
              0.9999999999999993,
              100,
              0
            ],
            "D": [
              1,
              0,
              -9.282041333256964e-8,
              0.9999999999999991,
              200,
              0
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                200,
                0,
                220,
                0,
                199.99999814359174,
                19.999999999999982
              ]
            }
          ]
        }
      ]
    }
  },
  "ik-two-order-b": {
    "id": "ik-two-order-b",
    "label": "⑥c 两约束 order 1→0",
    "group": "ik",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "rotation": 0,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 100
        },
        {
          "name": "D",
          "parent": "C",
          "x": 100,
          "y": 0,
          "rotation": 0,
          "length": 50
        },
        {
          "name": "T1",
          "parent": "root",
          "x": 100,
          "y": 100
        },
        {
          "name": "T2",
          "parent": "root",
          "x": 300,
          "y": 0
        },
        {
          "name": "T3",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [
        {
          "name": "chain",
          "bone": "D",
          "attachment": "dmesh"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "chain": {
              "dmesh": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  20,
                  0,
                  0,
                  20
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "ik": [
        {
          "name": "ik-a",
          "order": 1,
          "bones": [
            "P",
            "C"
          ],
          "target": "T1"
        },
        {
          "name": "ik-b",
          "order": 0,
          "bones": [
            "C",
            "D"
          ],
          "target": "T2"
        }
      ]
    },
    "atlasText": "case6.png\nsize: 64, 64\ndmesh\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 7,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 2
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "P": [
              1,
              0,
              -4.641020666628483e-8,
              0.9999999999999996,
              0,
              0
            ],
            "C": [
              -4.641020682709709e-8,
              0.9999999999999996,
              -0.9999999999999987,
              -2.3205103493954673e-8,
              100,
              0
            ],
            "D": [
              -4.641020682709709e-8,
              0.9999999999999996,
              -0.9999999999999973,
              -4.641020682709707e-8,
              99.99999535897932,
              99.99999999999996
            ]
          },
          "meshes": [
            {
              "slot": "chain",
              "attachment": "dmesh",
              "vertices": [
                99.99999535897932,
                99.99999999999996,
                99.99999443077519,
                119.99999999999994,
                79.99999535897938,
                99.99999907179583
              ]
            }
          ]
        }
      ]
    }
  },
  "fk-shear-onlytranslation": {
    "id": "fk-shear-onlytranslation",
    "label": "⑦ shear FK、OnlyTranslation、曲线动画采样",
    "group": "fk",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root",
          "rotation": 10,
          "scaleX": 2,
          "scaleY": 0.5
        },
        {
          "name": "b",
          "parent": "root",
          "x": 10,
          "y": 20,
          "rotation": 30,
          "shearX": 15,
          "shearY": -20,
          "scaleX": 1.5,
          "scaleY": 0.8
        },
        {
          "name": "c",
          "parent": "b",
          "inherit": "onlyTranslation",
          "x": 5,
          "y": 5,
          "rotation": 40,
          "scaleX": 1.2,
          "scaleY": 0.9
        }
      ],
      "slots": [
        {
          "name": "s7",
          "bone": "c",
          "attachment": "tex7"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s7": {
              "tex7": {
                "width": 8,
                "height": 8
              }
            }
          }
        }
      ],
      "animations": {
        "wiggle": {
          "bones": {
            "b": {
              "rotate": [
                {
                  "value": 10,
                  "curve": [
                    0.1,
                    12,
                    0.3,
                    20
                  ]
                },
                {
                  "time": 0.5,
                  "value": 25,
                  "curve": "stepped"
                },
                {
                  "time": 1,
                  "value": -5
                }
              ],
              "translate": [
                {
                  "x": 3,
                  "y": -2
                },
                {
                  "time": 0.5,
                  "x": 8,
                  "y": 4,
                  "curve": [
                    0.6,
                    9,
                    0.8,
                    6,
                    0.6,
                    5,
                    0.8,
                    3
                  ]
                },
                {
                  "time": 1,
                  "x": 0,
                  "y": 0
                }
              ],
              "shear": [
                {
                  "x": 5,
                  "y": -5
                },
                {
                  "time": 1,
                  "x": -5,
                  "y": 5
                }
              ]
            }
          }
        }
      }
    },
    "atlasText": "case7.png\nsize: 64, 64\ntex7\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 3,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 0
      },
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1.9696155051289663,
              0.3472963604122087,
              -0.086824101529335,
              0.49240387426747945,
              0,
              0
            ],
            "b": [
              1.9970018282602604,
              0.8906365969446601,
              -0.3420201929022517,
              0.33969260949828095,
              17.959673020702965,
              13.321041089471674
            ],
            "c": [
              0.9192533237875986,
              0.7713451411044554,
              -0.5785088718268677,
              0.689439979416341,
              26.234581197493007,
              19.472687121686377
            ]
          },
          "meshes": [
            {
              "slot": "s7",
              "attachment": "tex7",
              "vertices": [
                24.871603389650083,
                13.629546639603191,
                20.24353241503514,
                19.14506647493392,
                27.59755900533593,
                25.315827603769563,
                32.225629979950874,
                19.800307768438834
              ]
            }
          ]
        },
        {
          "label": "wiggle@0.25",
          "animation": "wiggle",
          "time": 0.25,
          "bones": {
            "root": [
              1.9696155051289663,
              0.3472963604122087,
              -0.086824101529335,
              0.49240387426747945,
              0,
              0
            ],
            "b": [
              1.1257791997461406,
              0.8892837641313259,
              -0.7313125205111549,
              0.23886477095229025,
              28.705734197382945,
              15.723574946006304
            ],
            "c": [
              0.9192533237875986,
              0.7713451411044554,
              -0.5785088718268677,
              0.689439979416341,
              30.678067593557873,
              21.364317621424384
            ]
          },
          "meshes": [
            {
              "slot": "s7",
              "attachment": "tex7",
              "vertices": [
                29.31508978571495,
                15.521177139341198,
                24.68701881110001,
                21.036696974671926,
                32.041045401400794,
                27.20745810350757,
                36.66911637601574,
                21.69193826817684
              ]
            }
          ]
        },
        {
          "label": "wiggle@0.75",
          "animation": "wiggle",
          "time": 0.75,
          "bones": {
            "root": [
              1.9696155051289663,
              0.3472963604122087,
              -0.086824101529335,
              0.49240387426747945,
              0,
              0
            ],
            "b": [
              1.0102862690442442,
              0.881739633166091,
              -1.0143265520778841,
              0.1433836886852157,
              29.462144219040667,
              16.946791370068738
            ],
            "c": [
              0.9192533237875986,
              0.7713451411044554,
              -0.5785088718268677,
              0.689439979416341,
              29.441942803872468,
              22.07240797932527
            ]
          },
          "meshes": [
            {
              "slot": "s7",
              "attachment": "tex7",
              "vertices": [
                28.078964996029544,
                16.229267497242084,
                23.450894021414605,
                21.744787332572812,
                30.804920611715392,
                27.915548461408456,
                35.43299158633033,
                22.400028626077727
              ]
            }
          ]
        }
      ]
    }
  },
  "stepped-missing-fields": {
    "id": "stepped-missing-fields",
    "label": "⑦b stepped + 缺字段 key：缺省值 0/1、key 不得被过滤",
    "group": "fk",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "b",
          "parent": "root",
          "x": 10,
          "y": 20,
          "rotation": 30
        }
      ],
      "slots": [],
      "skins": [],
      "animations": {
        "step": {
          "bones": {
            "b": {
              "translate": [
                {
                  "x": 10,
                  "curve": "stepped"
                },
                {
                  "time": 0.2,
                  "x": 20,
                  "curve": "stepped"
                },
                {
                  "time": 0.6,
                  "x": 60,
                  "curve": "stepped"
                },
                {
                  "time": 0.8,
                  "x": 80,
                  "y": 5,
                  "curve": "stepped"
                },
                {
                  "time": 1,
                  "x": 0,
                  "y": 0
                }
              ],
              "rotate": [
                {
                  "value": 10,
                  "curve": "stepped"
                },
                {
                  "time": 0.2,
                  "curve": "stepped"
                },
                {
                  "time": 0.6,
                  "value": -5,
                  "curve": "stepped"
                },
                {
                  "time": 1,
                  "value": 15
                }
              ],
              "scale": [
                {
                  "x": 2,
                  "curve": "stepped"
                },
                {
                  "time": 0.2,
                  "curve": "stepped"
                },
                {
                  "time": 0.6,
                  "x": 0.5,
                  "y": 3,
                  "curve": "stepped"
                },
                {
                  "time": 1,
                  "x": 1,
                  "y": 1
                }
              ]
            }
          }
        }
      }
    },
    "atlasText": "case7.png\nsize: 64, 64\ntex7\nbounds: 0, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 2,
        "slots": 0,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 0
      },
      "poses": [
        {
          "label": "step@0.1",
          "animation": "step",
          "time": 0.1,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "b": [
              1.5320888431474249,
              1.2855752351740921,
              -0.6427876531393264,
              0.766044421573712,
              19.999999535897935,
              19.999999999999996
            ]
          }
        },
        {
          "label": "step@0.4",
          "animation": "step",
          "time": 0.4,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "b": [
              0.8660253883143696,
              0.5000000066987362,
              -0.5000000468911536,
              0.8660253883143691,
              29.999999535897935,
              19.999999999999996
            ]
          }
        },
        {
          "label": "step@0.6",
          "animation": "step",
          "time": 0.6,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "b": [
              0.8660253883143696,
              0.5000000066987362,
              -0.5000000468911536,
              0.8660253883143691,
              29.999999535897935,
              19.999999999999996
            ]
          }
        },
        {
          "label": "step@0.9",
          "animation": "step",
          "time": 0.9,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ],
            "b": [
              0.45315388725280514,
              0.21130913379131713,
              -1.2678549289336973,
              2.71892332351683,
              89.99999941987241,
              24.999999999999993
            ]
          }
        }
      ]
    }
  },
  "unsupported-diagnostics": {
    "id": "unsupported-diagnostics",
    "label": "⑧ 不支持特性：诊断 + 原数据保留",
    "group": "diagnostics",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "weird",
          "parent": "root",
          "inherit": "noScaleOrReflection"
        },
        {
          "name": "nullbone",
          "parent": "root"
        }
      ],
      "slots": [
        {
          "name": "clip",
          "bone": "root",
          "attachment": "clip"
        },
        {
          "name": "seq",
          "bone": "root",
          "attachment": "seq"
        },
        {
          "name": "box",
          "bone": "root",
          "attachment": "box"
        },
        {
          "name": "nullslot",
          "bone": "nullbone",
          "attachment": null
        },
        {
          "name": "tex",
          "bone": "weird",
          "attachment": "tex8"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "clip": {
              "clip": {
                "type": "clipping",
                "end": "nullslot",
                "vertexCount": 3,
                "vertices": [
                  0,
                  0,
                  10,
                  0,
                  0,
                  10
                ]
              }
            },
            "seq": {
              "seq": {
                "type": "region",
                "width": 8,
                "height": 8,
                "sequence": {
                  "count": 3,
                  "start": 1
                }
              }
            },
            "box": {
              "box": {
                "type": "boundingbox",
                "vertexCount": 3,
                "vertices": [
                  0,
                  0,
                  5,
                  0,
                  0,
                  5
                ]
              }
            },
            "tex": {
              "tex8": {
                "width": 8,
                "height": 8
              },
              "texmesh": {
                "path": "tex8",
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  8,
                  0,
                  0,
                  8
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ],
      "transform": [
        {
          "name": "tc",
          "bones": [
            "weird"
          ],
          "target": "root",
          "mixRotate": 1
        }
      ],
      "path": [
        {
          "name": "pc",
          "bones": [
            "weird"
          ],
          "target": "tex",
          "position": 0
        }
      ],
      "physics": [
        {
          "name": "phc",
          "bone": "weird"
        }
      ],
      "animations": {
        "unsupported": {
          "bones": {
            "weird": {
              "rotate": [
                {
                  "value": 5
                },
                {
                  "time": 0.5,
                  "value": 10
                }
              ]
            }
          },
          "slots": {
            "tex": {
              "color": [
                {
                  "color": "ffffffff"
                },
                {
                  "time": 0.5,
                  "color": "ff0000ff"
                }
              ]
            }
          },
          "attachments": {
            "default": {
              "tex": {
                "texmesh": {
                  "deform": [
                    {
                      "offset": 0,
                      "vertices": [
                        1,
                        2
                      ]
                    }
                  ]
                }
              }
            }
          },
          "transform": {
            "tc": [
              {
                "mixRotate": 0.5
              }
            ]
          },
          "drawOrder": [
            {
              "offsets": [
                {
                  "slot": "tex",
                  "offset": -1
                }
              ]
            }
          ]
        }
      }
    },
    "atlasText": "case8.png\nsize: 64, 64\ntex8\nbounds: 0, 0, 8, 8\nseq1\nbounds: 8, 0, 8, 8\nseq2\nbounds: 16, 0, 8, 8\nseq3\nbounds: 24, 0, 8, 8\n",
    "textureSpec": {
      "width": 64,
      "height": 64,
      "cells": [
        {
          "rect": [
            0,
            0,
            32,
            32
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            32,
            0,
            32,
            32
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            32,
            32,
            32
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            32,
            32,
            32,
            32
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 3,
        "slots": 5,
        "meshes": 1,
        "weightedMeshes": 0,
        "ik": 0
      },
      "issueCodes": [
        "bone.inherit.unsupported",
        "model.transform.unsupported",
        "model.path.unsupported",
        "model.physics.unsupported",
        "attachment.unsupportedType",
        "attachment.sequence.unsupported",
        "animation.transform.unsupported",
        "animation.deform.unsupported",
        "animation.slotColor.unsupported"
      ],
      "poses": [
        {
          "label": "setup",
          "animation": null,
          "time": 0,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ]
          }
        },
        {
          "label": "unsupported@0.25",
          "animation": "unsupported",
          "time": 0.25,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ]
          }
        }
      ]
    }
  },
  "bad-uv-odd": {
    "id": "bad-uv-odd",
    "label": "退化：uvs 奇数长度",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  10,
                  0,
                  0,
                  10
                ],
                "triangles": [
                  0,
                  1,
                  2
                ],
                "hull": 3
              }
            }
          }
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "mesh.uvs.odd"
    }
  },
  "bad-triangle-index": {
    "id": "bad-triangle-index",
    "label": "退化：三角索引越界",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  10,
                  0,
                  0,
                  10
                ],
                "triangles": [
                  0,
                  1,
                  5
                ],
                "hull": 3
              }
            }
          }
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "mesh.triangles.index"
    }
  },
  "bad-triangle-count": {
    "id": "bad-triangle-count",
    "label": "退化：triangles 不是 3 的倍数",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0,
                  0,
                  1
                ],
                "vertices": [
                  0,
                  0,
                  10,
                  0,
                  0,
                  10
                ],
                "triangles": [
                  0,
                  1,
                  2,
                  0
                ],
                "hull": 3
              }
            }
          }
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "mesh.triangles.count"
    }
  },
  "bad-weights-zero": {
    "id": "bad-weights-zero",
    "label": "退化：权重和为 0",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0
                ],
                "vertices": [
                  2,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ],
                "triangles": [
                  0,
                  1,
                  1
                ],
                "hull": 3
              }
            }
          }
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "mesh.weights.zero"
    }
  },
  "bad-vertices-remainder": {
    "id": "bad-vertices-remainder",
    "label": "退化：加权分段截断",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "type": "mesh",
                "uvs": [
                  0,
                  0,
                  1,
                  0
                ],
                "vertices": [
                  2,
                  0,
                  0,
                  0,
                  1
                ],
                "triangles": [
                  0,
                  1,
                  1
                ],
                "hull": 3
              }
            }
          }
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "mesh.vertices.remainder"
    }
  },
  "bad-weights-sum": {
    "id": "bad-weights-sum",
    "label": "退化：权重和 0.8（warning 不重写）",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "type": "mesh",
                "uvs": [
                  0,
                  0
                ],
                "vertices": [
                  1,
                  0,
                  0,
                  0,
                  0.8
                ],
                "triangles": [
                  0,
                  0,
                  0
                ],
                "hull": 3
              }
            }
          }
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 1,
        "slots": 1,
        "meshes": 1,
        "weightedMeshes": 1,
        "ik": 0
      },
      "issueCodes": [
        "mesh.weights.sum"
      ]
    }
  },
  "bad-bone-cycle": {
    "id": "bad-bone-cycle",
    "label": "退化：骨循环",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "a",
          "parent": "b"
        },
        {
          "name": "b",
          "parent": "a"
        }
      ],
      "slots": [],
      "skins": []
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "bone.cycle"
    }
  },
  "bad-bone-parent": {
    "id": "bad-bone-parent",
    "label": "退化：缺父骨",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "a",
          "parent": "nope"
        }
      ],
      "slots": [],
      "skins": []
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "bone.parentMissing"
    }
  },
  "bad-ik-target": {
    "id": "bad-ik-target",
    "label": "退化：IK 缺 target",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "a",
          "parent": "root"
        }
      ],
      "slots": [],
      "skins": [],
      "ik": [
        {
          "name": "ik",
          "bones": [
            "a"
          ],
          "target": "nope"
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "ik.targetMissing"
    }
  },
  "bad-ik-chain": {
    "id": "bad-ik-chain",
    "label": "退化：两骨非父子",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "a",
          "parent": "root"
        },
        {
          "name": "b",
          "parent": "root"
        }
      ],
      "slots": [],
      "skins": [],
      "ik": [
        {
          "name": "ik",
          "bones": [
            "a",
            "b"
          ],
          "target": "root"
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": false,
      "errorCode": "ik.bones.notParentChild"
    }
  },
  "ik-zero-length": {
    "id": "ik-zero-length",
    "label": "退化：零长度骨 IK（warning 跳过）",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "length": 0
        },
        {
          "name": "C",
          "parent": "P",
          "x": 0,
          "y": 0,
          "length": 0
        },
        {
          "name": "T",
          "parent": "root",
          "x": 10,
          "y": 10
        }
      ],
      "slots": [],
      "skins": [],
      "ik": [
        {
          "name": "ik",
          "bones": [
            "P",
            "C"
          ],
          "target": "T"
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 0,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "pose",
          "animation": null,
          "time": 0
        }
      ]
    }
  },
  "ik-mirror": {
    "id": "ik-mirror",
    "label": "退化：镜像父骨 IK（warning 跳过）",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "scaleX": -1,
          "scaleY": 1,
          "length": 10
        },
        {
          "name": "C",
          "parent": "P",
          "x": 10,
          "y": 0,
          "length": 10
        },
        {
          "name": "T",
          "parent": "root",
          "x": 5,
          "y": 5
        }
      ],
      "slots": [],
      "skins": [],
      "ik": [
        {
          "name": "ik",
          "bones": [
            "P",
            "C"
          ],
          "target": "T"
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 0,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "pose",
          "animation": null,
          "time": 0
        }
      ]
    }
  },
  "ik-nonuniform": {
    "id": "ik-nonuniform",
    "label": "退化：非均匀父骨 IK（warning 跳过）",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "scaleX": 2,
          "scaleY": 1,
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "length": 100
        },
        {
          "name": "T",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [],
      "skins": [],
      "ik": [
        {
          "name": "ik",
          "bones": [
            "P",
            "C"
          ],
          "target": "T"
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 0,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "poses": [
        {
          "label": "pose",
          "animation": null,
          "time": 0
        }
      ]
    }
  },
  "ik-bad-inherit": {
    "id": "ik-bad-inherit",
    "label": "退化：复杂 inherit 骨 IK（warning 跳过）",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        },
        {
          "name": "P",
          "parent": "root",
          "inherit": "noRotationOrReflection",
          "length": 100
        },
        {
          "name": "C",
          "parent": "P",
          "x": 100,
          "y": 0,
          "length": 100
        },
        {
          "name": "T",
          "parent": "root",
          "x": 50,
          "y": 50
        }
      ],
      "slots": [],
      "skins": [],
      "ik": [
        {
          "name": "ik",
          "bones": [
            "P",
            "C"
          ],
          "target": "T"
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 4,
        "slots": 0,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 1
      },
      "issueCodes": [
        "bone.inherit.unsupported"
      ],
      "poses": [
        {
          "label": "pose",
          "animation": null,
          "time": 0
        }
      ]
    }
  },
  "no-visible-attachments": {
    "id": "no-visible-attachments",
    "label": "退化：全部 slot 无附件（无可见件）",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "a",
          "bone": "root",
          "attachment": null
        },
        {
          "name": "b",
          "bone": "root"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {}
        }
      ]
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 1,
        "slots": 2,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 0
      },
      "poses": [
        {
          "label": "pose",
          "animation": null,
          "time": 0
        }
      ],
      "emptyGeometry": true
    }
  },
  "null-attachment-animation": {
    "id": "null-attachment-animation",
    "label": "退化：attachment 动画 name:null 卸载",
    "group": "degenerate",
    "example": false,
    "json": {
      "skeleton": {
        "spine": "4.2.00"
      },
      "bones": [
        {
          "name": "root"
        }
      ],
      "slots": [
        {
          "name": "s",
          "bone": "root",
          "attachment": "m"
        }
      ],
      "skins": [
        {
          "name": "default",
          "attachments": {
            "s": {
              "m": {
                "width": 4,
                "height": 4
              },
              "n": {
                "path": "m",
                "width": 4,
                "height": 4
              }
            }
          }
        }
      ],
      "animations": {
        "hide": {
          "slots": {
            "s": {
              "attachment": [
                {
                  "name": "m"
                },
                {
                  "time": 0.5,
                  "name": null
                },
                {
                  "time": 1,
                  "name": "n"
                }
              ]
            }
          }
        }
      }
    },
    "atlasText": "case9.png\nsize: 32, 32\nm\nbounds: 0, 0, 4, 4\n",
    "textureSpec": {
      "width": 32,
      "height": 32,
      "cells": [
        {
          "rect": [
            0,
            0,
            16,
            16
          ],
          "color": "#e5484d",
          "label": "左上红"
        },
        {
          "rect": [
            16,
            0,
            16,
            16
          ],
          "color": "#46a758",
          "label": "右上绿"
        },
        {
          "rect": [
            0,
            16,
            16,
            16
          ],
          "color": "#3e63dd",
          "label": "左下蓝"
        },
        {
          "rect": [
            16,
            16,
            16,
            16
          ],
          "color": "#f5d90a",
          "label": "右下黄"
        }
      ]
    },
    "expected": {
      "parseOk": true,
      "counts": {
        "bones": 1,
        "slots": 1,
        "meshes": 0,
        "weightedMeshes": 0,
        "ik": 0
      },
      "poses": [
        {
          "label": "hide@0.25",
          "animation": "hide",
          "time": 0.25,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ]
          },
          "attachments": [
            "m"
          ]
        },
        {
          "label": "hide@0.75",
          "animation": "hide",
          "time": 0.75,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ]
          },
          "attachments": [
            null
          ]
        },
        {
          "label": "hide@1",
          "animation": "hide",
          "time": 1,
          "bones": {
            "root": [
              1,
              0,
              -2.3205103333142417e-8,
              0.9999999999999998,
              0,
              0
            ]
          },
          "attachments": [
            "n"
          ]
        }
      ]
    }
  }
};
  // 直接导出 case map（id -> case），与契约 A9 一致。
  global.SpineFixtures = Object.freeze(cases);
})(typeof globalThis !== "undefined" ? globalThis : this);
