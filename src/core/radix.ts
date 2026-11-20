import { Context } from "./context";

export class RadixNode {
  public children: Record<string, RadixNode> = {};
  public staticKeys: string[] = [];
  public paramNode: RadixNode | null = null;
  public paramName: string | null = null;
  public wildcardNode: RadixNode | null = null;
  public handlers: Record<string, Function> = {};

  public insert(path: string, method: string, handler: Function) {
    let node: RadixNode = this;
    const parts = path.split('/').filter(Boolean);
    for (const part of parts) {
      if (part === '*') {
        if (!node.wildcardNode) node.wildcardNode = new RadixNode();
        node = node.wildcardNode;
        break;
      } else if (part.startsWith(':')) {
        if (!node.paramNode) node.paramNode = new RadixNode();
        node.paramName = part.slice(1);
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
  }

  public lookup(method: string, url: string, start: number, ctx: Context) {
    let node: RadixNode = this;
    let i = start === -1 ? 0 : start;
    const len = url.length;
    if (url[i] === '/') i++;

    for (const k in ctx.params) delete ctx.params[k];

    while (i < len) {
      let j = url.indexOf('/', i);
      if (j === -1) j = len;
      const segmentLen = j - i;
      let found = false;

      const keys = node.staticKeys;
      const kLen = keys.length;

      if (kLen === 1) {
        const key = keys[0]!;
        if (key.length === segmentLen) {
          let match = true;
          for (let m = 0; m < segmentLen; m++) {
            if (key[m] !== url[i + m]) { match = false; break; }
          }
          if (match) { node = node.children[key]!; found = true; }
        }
      } else {
        for (let k = 0; k < kLen; k++) {
          const key = keys[k]!;
          if (key.length === segmentLen) {
            let match = true;
            for (let m = 0; m < segmentLen; m++) {
              if (key[m] !== url[i + m]) { match = false; break; }
            }
            if (match) { node = node.children[key]!; found = true; break; }
          }
        }
      }

      if (!found) {
        if (node.paramNode) {
          ctx.params[node.paramName!] = url.slice(i, j);
          node = node.paramNode;
        } else if (node.wildcardNode) {
          ctx.params['*'] = url.slice(i);
          return node.wildcardNode.handlers[method] || null;
        } else return null;
      }
      i = j + 1;
    }
    return node.handlers[method] || null;
  }

  public jitCompile(
    register: (h: Function) => string,
    level = 0,
    pathPrefix = 'url',
    idxPrefix = 's',
    paramAccumulator: { name: string, varName: string }[] = []
  ): string {
    let code = '';
    const indent = '  '.repeat(level);


    if (Object.keys(this.handlers).length > 0) {
      code += `${indent}if (${idxPrefix} >= urlLen) {\n`;
      

      if (paramAccumulator.length > 0) {
        const props = paramAccumulator.map((p: any) => `${JSON.stringify(p.name)}: ${p.varName}`).join(', ');
        code += `${indent}  ctx.params = { ${props} };\n`;
      }

      code += `${indent}  switch(method) {\n`;
      for (const [m, h] of Object.entries(this.handlers)) {
        const hName = register(h as Function);
        code += `${indent}    case ${JSON.stringify(m)}: return ${hName}(ctx);\n`;
      }
      code += `${indent}  }\n`;
      code += `${indent}}\n`;
    }

    // 1. Static Keys & 2. Param Node Logic (requires idxPrefix < urlLen)
    if (this.staticKeys.length > 0 || this.paramNode) {
      code += `${indent}if (${idxPrefix} < urlLen) {\n`;
      const innerIndent = indent + '  ';

      if (this.staticKeys.length > 0) {
        if (this.staticKeys.length === 1) {
          const key = this.staticKeys[0]!;
          const kLen = key.length;
          const nextIdxVar = `nextIdxL${level}`;

          code += `${innerIndent}if (${pathPrefix}.startsWith(${JSON.stringify(key)}, ${idxPrefix})) {\n`;
          code += `${innerIndent}  const ${nextIdxVar} = ${idxPrefix} + ${kLen};\n`;
          code += `${innerIndent}  if (${nextIdxVar} === urlLen || ${pathPrefix}.charCodeAt(${nextIdxVar}) === 47) {\n`;

          const child = this.children[key]!;
          const newIdxVar = `newIdxL${level}`;
          code += `${innerIndent}    const ${newIdxVar} = ${nextIdxVar} === urlLen ? urlLen : (${nextIdxVar} + 1);\n`;

          code += child.jitCompile(register, level + 1, pathPrefix, newIdxVar, paramAccumulator);

          code += `${innerIndent}  }\n`;
          code += `${innerIndent}}\n`;

        } else if (this.staticKeys.length > 4) {
          code += `${innerIndent}let slash${level} = ${pathPrefix}.indexOf('/', ${idxPrefix});\n`;
          code += `${innerIndent}if (slash${level} === -1 || slash${level} > urlLen) slash${level} = urlLen;\n`;
          code += `${innerIndent}switch (${pathPrefix}.slice(${idxPrefix}, slash${level})) {\n`;
          for (const key of this.staticKeys) {
            code += `${innerIndent}  case ${JSON.stringify(key)}: {\n`;
            const child = this.children[key]!;
            code += child.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, paramAccumulator);
            code += `${innerIndent}    break;\n`;
            code += `${innerIndent}  }\n`;
          }
          code += `${innerIndent}}\n`;
        } else {
          code += `${innerIndent}let slash${level} = ${pathPrefix}.indexOf('/', ${idxPrefix});\n`;
          code += `${innerIndent}if (slash${level} === -1 || slash${level} > urlLen) slash${level} = urlLen;\n`;
          code += `${innerIndent}const len${level} = slash${level} - (${idxPrefix});\n\n`;

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
              code += child.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, paramAccumulator);

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

        const newAccumulator = [...paramAccumulator, { name: this.paramName!, varName: pVar }];
        code += pNode.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, newAccumulator);
        code += `${innerIndent}}\n`;
      }

      code += `${indent}}\n`;
    }

    // 3. Wildcard Node Logic (Catch-All *)
    if (this.wildcardNode && Object.keys(this.wildcardNode.handlers).length > 0) {
      const wVar = `wL${level}`;
      code += `${indent}const ${wVar} = ${pathPrefix}.slice(${idxPrefix}, urlLen);\n`;
      const wAcc = [...paramAccumulator, { name: '*', varName: wVar }];
      const props = wAcc.map((p: any) => `${JSON.stringify(p.name)}: ${p.varName}`).join(', ');
      code += `${indent}ctx.params = { ${props} };\n`;
      code += `${indent}switch(method) {\n`;
      for (const [m, h] of Object.entries(this.wildcardNode.handlers)) {
        const hName = register(h as Function);
        code += `${indent}  case ${JSON.stringify(m)}: return ${hName}(ctx);\n`;
      }
      code += `${indent}}\n`;
    }

    return code;
  }
}
