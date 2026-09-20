// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item)
}

function trimWrap(str: string): string {
  if (str.startsWith('<') && str.endsWith('>')) {
    return str.slice(1, -1)
  }
  return str
}

// override / 附加配置里 `+key` 表示「并入 key」：数组插到前面，对象/标量就是普通合并。
// 之前只处理了数组，`+proxy-providers` 这种对象键会被原样写成字面量键 `+proxy-providers`，
// 内核不认这个键 → provider 没注册，proxy-groups 一 use 就报 "proxy [...] not found"。
function overrideKey(key: string, isOverride?: boolean): string {
  if (!isOverride) return key
  return key.startsWith('+') ? key.slice(1) : key
}

export function deepMerge<T extends object>(target: T, other: Partial<T>, isOverride?: boolean): T {
  for (const key in other) {
    if (isObject(other[key])) {
      if (key.endsWith('!')) {
        const k = trimWrap(key.slice(0, -1))
        target[k] = other[key]
      } else {
        const k = trimWrap(key)
        // +key 只改「目标键名」（并入 key，而不是新建字面量键 "+key"）；取值仍然用源键 k
        const targetKey = trimWrap(overrideKey(k, isOverride))
        if (!target[targetKey]) Object.assign(target, { [targetKey]: {} })
        deepMerge(target[targetKey] as object, other[k] as object, isOverride)
      }
    } else if (Array.isArray(other[key])) {
      if (isOverride && key.startsWith('+')) {
        const k = trimWrap(key.slice(1))
        if (!target[k]) Object.assign(target, { [k]: [] })
        target[k] = [...other[key], ...(target[k] as never[])]
      } else if (isOverride && key.endsWith('+')) {
        const k = trimWrap(key.slice(0, -1))
        if (!target[k]) Object.assign(target, { [k]: [] })
        target[k] = [...(target[k] as never[]), ...other[key]]
      } else {
        const k = trimWrap(key)
        Object.assign(target, { [k]: other[key] })
      }
    } else {
      Object.assign(target, { [trimWrap(overrideKey(key, isOverride))]: other[key] })
    }
  }
  return target as T
}
