


export interface ImportDiff {
  
  toAdd: string[]
  
  existing: string[]
  
  orphanRaws: string[]
}


export function previewImport(rootImages: string[], rawImages: string[]): ImportDiff {
  const rawsSet = new Set(rawImages)
  const rootSet = new Set(rootImages)

  const toAdd: string[] = []
  const existing: string[] = []
  for (const name of rootImages) {
    if (rawsSet.has(name)) existing.push(name)
    else toAdd.push(name)
  }

  const orphanRaws: string[] = []
  for (const name of rawImages) {
    if (!rootSet.has(name)) orphanRaws.push(name)
  }

  return { toAdd, existing, orphanRaws }
}
