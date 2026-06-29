import { describe, it, expect, beforeEach } from 'vitest'

// Replicate the localStorage keys and persistence logic for unit testing
const LS_MEMBERS = 'nullhaven:asp:members'
const LS_DENIED  = 'nullhaven:asp:denied'
const LS_ROOT    = 'nullhaven:asp:root'

interface AspEntry { commitment: string; label: string; addedAt: string }

// Simulate the load effect
function loadPersistedLists(): { members: AspEntry[]; denied: AspEntry[] } {
  let members: AspEntry[] = []
  let denied: AspEntry[] = []
  try {
    members = JSON.parse(localStorage.getItem(LS_MEMBERS) ?? '[]')
  } catch { members = [] }
  try {
    denied = JSON.parse(localStorage.getItem(LS_DENIED) ?? '[]')
  } catch { denied = [] }
  return { members, denied }
}

// Simulate the persist effect on add denied
function persistDeniedList(denied: AspEntry[], updated: AspEntry[]): AspEntry[] {
  localStorage.setItem(LS_DENIED, JSON.stringify(updated))
  return updated
}

describe('Admin localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses correct localStorage keys', () => {
    expect(LS_MEMBERS).toBe('nullhaven:asp:members')
    expect(LS_DENIED).toBe('nullhaven:asp:denied')
    expect(LS_ROOT).toBe('nullhaven:asp:root')
  })

  it('loads empty arrays when localStorage is empty', () => {
    const { members, denied } = loadPersistedLists()
    expect(members).toEqual([])
    expect(denied).toEqual([])
  })

  it('loads persisted denied list from localStorage', () => {
    const mockDenied: AspEntry[] = [
      { commitment: 'abc123', label: 'test', addedAt: '2024-01-01' },
    ]
    localStorage.setItem(LS_DENIED, JSON.stringify(mockDenied))
    const { denied } = loadPersistedLists()
    expect(denied).toEqual(mockDenied)
  })

  it('loads persisted members list from localStorage', () => {
    const mockMembers: AspEntry[] = [
      { commitment: 'def456', label: 'member', addedAt: '2024-02-01' },
    ]
    localStorage.setItem(LS_MEMBERS, JSON.stringify(mockMembers))
    const { members } = loadPersistedLists()
    expect(members).toEqual(mockMembers)
  })

  it('persists denied list to localStorage', () => {
    const existing: AspEntry[] = [
      { commitment: 'abc123', label: 'existing', addedAt: '2024-01-01' },
    ]
    const newEntry: AspEntry = {
      commitment: 'def456',
      label: 'new',
      addedAt: '2024-03-01',
    }
    const updated = [...existing, newEntry]
    persistDeniedList(existing, updated)
    expect(JSON.parse(localStorage.getItem(LS_DENIED) ?? '[]')).toEqual(updated)
  })

  it('handles corrupted localStorage gracefully for denied', () => {
    localStorage.setItem(LS_DENIED, 'not-json')
    const { denied } = loadPersistedLists()
    expect(denied).toEqual([])
  })

  it('handles corrupted localStorage gracefully for members', () => {
    localStorage.setItem(LS_MEMBERS, 'not-json')
    const { members } = loadPersistedLists()
    expect(members).toEqual([])
  })

  it('does not interfere between members and denied keys', () => {
    localStorage.setItem(LS_MEMBERS, JSON.stringify([{ commitment: 'm1', label: 'm', addedAt: '2024-01-01' }]))
    localStorage.setItem(LS_DENIED, JSON.stringify([{ commitment: 'd1', label: 'd', addedAt: '2024-02-01' }]))
    const { members, denied } = loadPersistedLists()
    expect(members).toHaveLength(1)
    expect(members[0].commitment).toBe('m1')
    expect(denied).toHaveLength(1)
    expect(denied[0].commitment).toBe('d1')
  })
})
