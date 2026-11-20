import { Context } from "./context";

export class RadixNode {
  public children: Record<string, RadixNode> = Object.create(null);
  public staticKeys: string[] = [];
  public paramNode: RadixNode | null = null;
  public paramName: string | null = null;
  public wildcardNode: RadixNode | null = null;
  public handlers: Record<string, Function> = Object.create(null);
  public handlerParams: Record<string, string[]> = Object.create(null);

  public insert(path: string, method: string, handler: Function) {
    let node: RadixNode = this;
    const parts = path.split('/').filter(Boolean);
    const paramNames: string[] = [];
    for (const part of parts) {
      if (part === '*') {
        if (!node.wildcardNode) node.wildcardNode = new RadixNode();
        node = node.wildcardNode;
        break;
      } else if (part.startsWith(':')) {
        if (!node.paramNode) node.paramNode = new RadixNode();
        const pName = part.slice(1);
        if (!node.paramName) node.paramName = pName;
        paramNames.push(pName);
        node = node.paramNode;
      } else {
        if (!node.children[part]) {
          node.children[part] = new RadixNode();
          node.staticKeys.push(part);
        }
        node = node.children[part]!;
      }
    }
    node.handlers[method] = handler;
    node.handlerParams[method] = paramNames;
  }

  public lookup(method: string, url: string, start: number, ctx: Context) {
    let i = start === -1 ? 0 : start;
    const q = url.indexOf('?', i);
    const len = q === -1 ? url.length : q;
    if (url[i] === '/') i++;

    const applyParams = (names: string[], values: string[], wildcardVal?: string) => {
      const hasProto = names.includes('__proto__');
      const out: Record<string, string> = hasProto ? Object.create(null) : {};
      for (let p = 0; p < names.length; p++) {
        out[names[p]!] = values[p]!;
      }
      if (wildcardVal !== undefined) out['*'] = wildcardVal;
      ctx.params = out;
    };

    const matchNode = (node: RadixNode, pos: number, pVals: string[]): Function | null => {
      if (pos >= len) {
        const h = node.handlers[method];
        if (h) {
          applyParams(node.handlerParams[method] || [], pVals);
          return h;
        }
        if (node.wildcardNode && node.wildcardNode.handlers[method]) {
          applyParams(node.wildcardNode.handlerParams[method] || [], pVals, '');
          return node.wildcardNode.handlers[method]!;
        }
        return null;
      }

      let j = url.indexOf('/', pos);
      if (j === -1 || j > len) j = len;
      const segmentLen = j - pos;

      const keys = node.staticKeys;
      const kLen = keys.length;
      let matchedChild: RadixNode | null = null;

      if (kLen === 1) {
        const key = keys[0]!;
        if (key.length === segmentLen) {
          let match = true;
          for (let m = 0; m < segmentLen; m++) {
            if (key[m] !== url[pos + m]) { match = false; break; }
          }
          if (match) matchedChild = node.children[key]!;
        }
      } else {
        for (let k = 0; k < kLen; k++) {
          const key = keys[k]!;
          if (key.length === segmentLen) {
            let match = true;
            for (let m = 0; m < segmentLen; m++) {
              if (key[m] !== url[pos + m]) { match = false; break; }
            }
            if (match) { matchedChild = node.children[key]!; break; }
          }
        }
      }

      if (matchedChild) {
        const res = matchNode(matchedChild, j + 1, pVals);
        if (res) return res;
      }

      if (node.paramNode && segmentLen > 0) {
        pVals.push(url.slice(pos, j));
        const res = matchNode(node.paramNode, j + 1, pVals);
        if (res) return res;
        pVals.pop();
      }

      if (node.wildcardNode && node.wildcardNode.handlers[method]) {
        applyParams(node.wildcardNode.handlerParams[method] || [], pVals, url.slice(pos, len));
        return node.wildcardNode.handlers[method]!;
      }

      return null;
    };

    ctx.params = {};
    return matchNode(this, i, []);
  }

  private emitParamsAssign(indent: string, names: string[], vars: string[]): string {
    if (names.length === 0) return '';
    if (names.includes('__proto__')) {
      let s = `${indent}const _p = Object.create(null);\n`;
      for (let i = 0; i < names.length; i++) {
        s += `${indent}_p[${JSON.stringify(names[i])}] = ${vars[i]};\n`;
      }
      return s + `${indent}ctx.params = _p;\n`;
    }
    const props = names.map((n, i) => `${JSON.stringify(n)}: ${vars[i]}`).join(', ');
    return `${indent}ctx.params = { ${props} };\n`;
  }

  public jitCompile(
    register: (h: Function) => string,
    level = 0,
    pathPrefix = 'url',
    idxPrefix = 's',
    paramVars: string[] = []
  ): string {
    let code = '';
    const indent = '  '.repeat(level);

    if (Object.keys(this.handlers).length > 0) {
      code += `${indent}if (${idxPrefix} >= urlLen) {\n`;
      code += `${indent}  switch(method) {\n`;
      for (const [m, h] of Object.entries(this.handlers)) {
        const hName = register(h as Function);
        const pNames = this.handlerParams[m] || [];
        const pAssign = pNames.length > 0 ? this.emitParamsAssign('', pNames, paramVars).trim() + ' ' : '';
        code += `${indent}    case ${JSON.stringify(m)}: ${pAssign}return ${hName}(ctx);\n`;
      }
      code += `${indent}  }\n`;
      code += `${indent}}\n`;
    }

    const hasChildren = this.staticKeys.length > 0 || this.paramNode !== null;
    if (hasChildren) {
      const innerIndent = indent + '  ';
      code += `${indent}if (${idxPrefix} < urlLen) {\n`;

      if (this.staticKeys.length > 0) {
        if (this.staticKeys.length === 1) {
          const key = this.staticKeys[0]!;
          const child = this.children[key]!;
          const kLen = key.length;
          const endCheck = `${idxPrefix} + ${kLen} === urlLen || ${pathPrefix}.charCodeAt(${idxPrefix} + ${kLen}) === 47`;
          if (kLen === 1) {
            code += `${innerIndent}if (${pathPrefix}.charCodeAt(${idxPrefix}) === ${key.charCodeAt(0)} && (${endCheck})) {\n`;
          } else {
            code += `${innerIndent}if (${pathPrefix}.startsWith(${JSON.stringify(key)}, ${idxPrefix}) && (${endCheck})) {\n`;
          }
          code += child.jitCompile(register, level + 1, pathPrefix, `${idxPrefix} + ${kLen + 1}`, paramVars);
          code += `${innerIndent}}\n`;
        } else {
          code += `${innerIndent}let slash${level} = ${pathPrefix}.indexOf('/', ${idxPrefix});\n`;
          code += `${innerIndent}if (slash${level} === -1 || slash${level} > urlLen) slash${level} = urlLen;\n`;
          code += `${innerIndent}const len${level} = slash${level} - (${idxPrefix});\n`;

          const byLen = new Map<number, string[]>();
          for (const key of this.staticKeys) {
            let list = byLen.get(key.length);
            if (!list) {
              list = [];
              byLen.set(key.length, list);
            }
            list.push(key);
          }

          code += `${innerIndent}switch(len${level}) {\n`;
          for (const [kLen, keysForLen] of byLen) {
            code += `${innerIndent}  case ${kLen}:\n`;
            for (const key of keysForLen) {
              if (kLen === 1) {
                code += `${innerIndent}    if (${pathPrefix}.charCodeAt(${idxPrefix}) === ${key.charCodeAt(0)}) {\n`;
              } else {
                code += `${innerIndent}    if (${pathPrefix}.startsWith(${JSON.stringify(key)}, ${idxPrefix})) {\n`;
              }

              const child = this.children[key]!;
              code += child.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, paramVars);

              code += `${innerIndent}    }\n`;
            }
            code += `${innerIndent}    break;\n`;
          }
          code += `${innerIndent}}\n`;
        }
      }

      if (this.paramNode) {
        const pNode = this.paramNode;
        if (this.staticKeys.length <= 1) {
          code += `${innerIndent}let slash${level} = ${pathPrefix}.indexOf('/', ${idxPrefix});\n`;
          code += `${innerIndent}if (slash${level} === -1 || slash${level} > urlLen) slash${level} = urlLen;\n`;
        }

        const pVar = `pL${level}`;
        code += `${innerIndent}if (slash${level} > ${idxPrefix}) {\n`;
        code += `${innerIndent}  const ${pVar} = ${pathPrefix}.slice(${idxPrefix}, slash${level});\n`;

        const newVars = [...paramVars, pVar];
        code += pNode.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, newVars);
        code += `${innerIndent}}\n`;
      }

      code += `${indent}}\n`;
    }

    // 3. Wildcard Node Logic (Catch-All *)
    if (this.wildcardNode && Object.keys(this.wildcardNode.handlers).length > 0) {
      const wVar = `wL${level}`;
      code += `${indent}const ${wVar} = ${pathPrefix}.slice(${idxPrefix}, urlLen);\n`;
      code += `${indent}switch(method) {\n`;
      for (const [m, h] of Object.entries(this.wildcardNode.handlers)) {
        const hName = register(h as Function);
        const pNames = [...(this.wildcardNode.handlerParams[m] || []), '*'];
        const pVars = [...paramVars, wVar];
        const pAssign = this.emitParamsAssign('', pNames, pVars).trim();
        code += `${indent}  case ${JSON.stringify(m)}: ${pAssign} return ${hName}(ctx);\n`;
      }
      code += `${indent}}\n`;
    }

    return code;
  }
}
