#!/usr/bin/env python3
"""把引擎与应用逻辑注入模板，生成离线单文件。

用法：
  python build.py          # v1：自研 SVG 竖式树  -> family-tree.html
  python build.py --fc     # v2：family-chart 渲染 -> family-tree-v2.html

两份文件共用同一个 localStorage 键，数据可互换。
"""
import os
import sys
import hashlib
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # workspace root


def read(name):
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return f.read()


def build_v1():
    engine = read('engine.js')
    app = read('app.js')
    tpl = read('template.html')
    assert '/*==ENGINE==*/' in tpl, 'engine placeholder missing'
    assert '/*==APP==*/' in tpl, 'app placeholder missing'
    h = hashlib.sha1((engine + app + tpl).encode('utf-8')).hexdigest()[:7]
    token = 'build ' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M') + ' · ' + h
    out = (tpl.replace('/*==ENGINE==*/', engine)
              .replace('/*==APP==*/', app)
              .replace('__BUILD_TOKEN__', token))
    return out, token, 'family-tree.html'


def build_v2():
    d3 = read('lib/d3.min.js')
    fc = read('lib/family-chart.min.js')
    fccs = read('lib/family-chart.css')
    engine = read('engine.js')
    app = read('app-fc.js')
    tpl = read('template-fc.html')
    for ph in ('/*==D3==*/', '/*==FC==*/', '/*==FCCS==*/', '/*==ENGINE==*/', '/*==APP==*/'):
        assert ph in tpl, 'placeholder missing: ' + ph
    # 防止内联内容提前闭合 script/style 标签
    for name, src in (('d3', d3), ('family-chart', fc)):
        assert '</script' not in src.lower(), name + ' contains </script>'
    assert '</style' not in fccs.lower(), 'css contains </style>'

    h = hashlib.sha1((d3 + fc + fccs + engine + app + tpl).encode('utf-8')).hexdigest()[:7]
    token = 'build ' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M') + ' · ' + h + ' · v2-fc'
    out = (tpl.replace('/*==FCCS==*/', fccs)
              .replace('/*==D3==*/', d3)
              .replace('/*==FC==*/', fc)
              .replace('/*==ENGINE==*/', engine)
              .replace('/*==APP==*/', app)
              .replace('__BUILD_TOKEN__', token))
    return out, token, 'family-tree-v2.html'


def build_v3():
    engine = read('engine.js')
    app = read('app-v3.js')
    tpl = read('template-v3.html')
    for ph in ('/*==ENGINE==*/', '/*==APP==*/'):
        assert ph in tpl, 'placeholder missing: ' + ph
    for name, src in (('engine', engine), ('app-v3', app)):
        assert '</script' not in src.lower(), name + ' contains </script>'
    h = hashlib.sha1((engine + app + tpl).encode('utf-8')).hexdigest()[:7]
    token = 'build ' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M') + ' · ' + h + ' · v3-panorama'
    out = (tpl.replace('/*==ENGINE==*/', engine)
              .replace('/*==APP==*/', app)
              .replace('__BUILD_TOKEN__', token))
    return out, token, 'family-tree-v3.html'


def emit(builder):
    out, token, name = builder()
    dest = os.path.join(ROOT, name)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    print('written:', dest, 'bytes:', len(out.encode('utf-8')))
    print('build token:', token)


if __name__ == '__main__':
    if '--all' in sys.argv:
        emit(build_v1)
        emit(build_v2)
        emit(build_v3)
    elif '--fc' in sys.argv:
        emit(build_v2)
    elif '--v3' in sys.argv:
        emit(build_v3)
    else:
        emit(build_v1)
