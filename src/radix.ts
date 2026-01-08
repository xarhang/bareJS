import { Context } from "./context";

export class RadixNode {
  public children: Record<string, RadixNode> = {};
  public staticKeys: string[] = [];
  public paramNode: RadixNode | null = null;
  public paramName: string | null = null;
  public handlers: Record<string, Function> = {};

  public insert(path: string, method: string, handler: Function) {
    let node: RadixNode = this;
    const parts = path.split('/').filter(Boolean);
    for (const part of parts) {
      if (part.startsWith(':')) {
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

    // ล้าง params เดิมใน ctx (Zero-allocation)
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
          // เขียนลง ctx.params โดยตรง
          ctx.params[node.paramName!] = url.slice(i, j);
          node = node.paramNode;
        } else return null;
      }
      i = j + 1;
    }
    return node.handlers[method] || null;
  }

  // 🔥 JIT Compiler: เปลี่ยน Tree ให้เป็น Code (If-Else)
  public jitCompile(
    register: (h: Function) => string,
    level = 0,
    pathPrefix = 'url',
    idxPrefix = 's',
    paramAccumulator: { name: string, varName: string }[] = []
  ): string {
    let code = '';
    const indent = '  '.repeat(level);

    // 1. Static Children
    if (this.staticKeys.length > 0) {
      if (this.staticKeys.length === 1) {
        // ⚡ Optim: Single Child Fast Path
        const key = this.staticKeys[0]!;
        const kLen = key.length;

        code += `${indent}if (${pathPrefix}.startsWith("${key}", ${idxPrefix})) {\n`;
        code += `${indent}  const nextChar = ${pathPrefix}.charCodeAt(${idxPrefix} + ${kLen});\n`;
        code += `${indent}  if (isNaN(nextChar) || nextChar === 47) {\n`;

        const child = this.children[key]!;
        const newIdxVar = `newIdx${level}`;
        code += `${indent}    const ${newIdxVar} = isNaN(nextChar) ? ${pathPrefix}.length : (${idxPrefix} + ${kLen} + 1);\n`;

        code += child.jitCompile(register, level + 1, pathPrefix, newIdxVar, paramAccumulator);

        if (Object.keys(child.handlers).length > 0) {
          code += `${indent}    if (${newIdxVar} >= ${pathPrefix}.length) {\n`;

          // ⚡ JIT: Construct Params Object
          if (paramAccumulator.length > 0) {
            const props = paramAccumulator.map((p: any) => `"${p.name}": ${p.varName}`).join(', ');
            code += `${indent}      ctx.params = { ${props} };\n`;
          }

          code += `${indent}      switch(method) {\n`;
          for (const [m, h] of Object.entries(child.handlers)) {
            const hName = register(h as Function);
            code += `${indent}        case "${m}": return ${hName}(ctx);\n`;
          }
          code += `${indent}      }\n`;
          code += `${indent}    }\n`;
        }

        code += `${indent}  }\n`;
        code += `${indent}}\n`;

      } else {
        // Multi-Path Branching
        code += `${indent}let slash${level} = ${pathPrefix}.indexOf('/', ${idxPrefix});\n`;
        code += `${indent}if (slash${level} === -1) slash${level} = ${pathPrefix}.length;\n`;
        code += `${indent}const len${level} = slash${level} - (${idxPrefix});\n\n`; // FIXED PRECEDENCE

        code += `${indent}switch(len${level}) {\n`;

        for (const key of this.staticKeys) {
          code += `${indent}  case ${key.length}: // "${key}"\n`;
          if (key.length === 1) {
            code += `${indent}    if (${pathPrefix}.charCodeAt(${idxPrefix}) === ${key.charCodeAt(0)}) {\n`;
          } else {
            code += `${indent}    if (${pathPrefix}.startsWith("${key}", ${idxPrefix})) {\n`;
          }

          const child = this.children[key]!;
          code += child.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, paramAccumulator);

          if (Object.keys(child.handlers).length > 0) {
            code += `${indent}      if (slash${level} === ${pathPrefix}.length) {\n`;

            // ⚡ JIT: Construct Params Object
            if (paramAccumulator.length > 0) {
              const props = paramAccumulator.map((p: any) => `"${p.name}": ${p.varName}`).join(', ');
              code += `${indent}        ctx.params = { ${props} };\n`;
            }

            code += `${indent}        switch(method) {\n`;
            for (const [m, h] of Object.entries(child.handlers)) {
              const hName = register(h as Function);
              code += `${indent}          case "${m}": return ${hName}(ctx);\n`;
            }
            code += `${indent}        }\n`;
            code += `${indent}      }\n`;
          }

          code += `${indent}    }\n`;
          code += `${indent}    break;\n`;
        }
        code += `${indent}}\n`;
      }
    }

    // 2. Param Node (Fallback)
    if (this.paramNode) {
      const pNode = this.paramNode;
      if (this.staticKeys.length === 0) {
        code += `${indent}let slash${level} = ${pathPrefix}.indexOf('/', ${idxPrefix});\n`;
        code += `${indent}if (slash${level} === -1) slash${level} = ${pathPrefix}.length;\n`;
      }

      // ⚡ Optim: Capture Param into Local Variable (Stack)
      const pVar = `p${level}`;
      code += `${indent}const ${pVar} = ${pathPrefix}.slice(${idxPrefix}, slash${level});\n`;

      const newAccumulator = [...paramAccumulator, { name: this.paramName!, varName: pVar }];

      code += pNode.jitCompile(register, level + 1, pathPrefix, `slash${level} + 1`, newAccumulator);

      if (Object.keys(pNode.handlers).length > 0) {
        code += `${indent}if (slash${level} === ${pathPrefix}.length) {\n`;

        // ⚡ JIT: Construct Params Object
        if (newAccumulator.length > 0) {
          const props = newAccumulator.map((p: any) => `"${p.name}": ${p.varName}`).join(', ');
          code += `${indent}  ctx.params = { ${props} };\n`;
        }

        code += `${indent}  switch(method) {\n`;
        for (const [m, h] of Object.entries(pNode.handlers)) {
          const hName = register(h as Function);
          code += `${indent}    case "${m}": return ${hName}(ctx);\n`;
        }
        code += `${indent}  }\n`;
        code += `${indent}}\n`;
      }
    }

    return code;
  }

  // Helper for ID generation
  public id = Math.random().toString(36).slice(2);
}