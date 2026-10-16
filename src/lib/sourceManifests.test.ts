import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSourceManifest,
  deleteSourceManifest,
  listSourceManifests,
  sourceManifestObjectKey,
  updateSourceManifestContent,
} from './sourceManifests'

beforeEach(() => {
  localStorage.clear()
})

describe('sourceManifests', () => {
  it('starts empty', () => {
    expect(listSourceManifests()).toEqual([])
  })

  it('adds an inline manifest and generates an id', () => {
    const created = addSourceManifest({ label: 'main', kind: 'inline', content: 'sources: []' })
    expect(created.id).toBeTruthy()
    expect(listSourceManifests()).toEqual([created])
  })

  it('adds a reference manifest', () => {
    const created = addSourceManifest({ label: 'main', kind: 'reference', connectionId: 'conn-1', key: 'sources.yml' })
    expect(listSourceManifests()).toEqual([created])
  })

  it('updates only the content of an inline manifest, preserving everything else', () => {
    const created = addSourceManifest({ label: 'main', kind: 'inline', content: 'old' })
    updateSourceManifestContent(created.id, 'new content')

    const [updated] = listSourceManifests()
    expect(updated).toEqual({ ...created, content: 'new content' })
  })

  it('deletes a manifest', () => {
    const a = addSourceManifest({ label: 'a', kind: 'inline', content: '' })
    const b = addSourceManifest({ label: 'b', kind: 'inline', content: '' })

    deleteSourceManifest(a.id)

    expect(listSourceManifests()).toEqual([b])
  })

  it('builds the expected _quarry object key for a manifest label', () => {
    expect(sourceManifestObjectKey('main')).toBe('_quarry/sources/main.yml')
  })
})
