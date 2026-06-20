import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const projectDir = join(import.meta.dirname, '..', '..')
const indexPath = join(projectDir, 'src', 'main', 'index.ts')
const requiredSnapshotFields = [
  'opencodeSessionCookie',
  'opencodeWorkspaceId',
  'geminiCliOAuthEnabled'
]

function parseSource(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
}

function findSetSettingsResolverCall(sourceFile) {
  let match = null

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'setSettingsResolver' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'rateLimits'
    ) {
      match = node
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return match
}

function getReturnedObjectLiteral(callback) {
  if (!ts.isArrowFunction(callback)) {
    return null
  }

  if (ts.isObjectLiteralExpression(callback.body)) {
    return callback.body
  }

  if (!ts.isBlock(callback.body)) {
    return null
  }

  const returnStatement = callback.body.statements.find(ts.isReturnStatement)
  return returnStatement?.expression && ts.isObjectLiteralExpression(returnStatement.expression)
    ? returnStatement.expression
    : null
}

function getPropertyName(property) {
  if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
    return null
  }

  return property.name.text
}

describe('rate-limit settings resolver contract', () => {
  it('passes a narrow settings snapshot instead of the full persisted settings', () => {
    const sourceFile = parseSource(indexPath)
    const call = findSetSettingsResolverCall(sourceFile)
    expect(call).toBeTruthy()

    const snapshot = getReturnedObjectLiteral(call.arguments[0])
    expect(snapshot).toBeTruthy()

    const propertyNames = snapshot.properties.map(getPropertyName)
    expect(propertyNames).toEqual(requiredSnapshotFields)

    for (const [index, field] of requiredSnapshotFields.entries()) {
      const property = snapshot.properties[index]
      expect(ts.isPropertyAssignment(property)).toBe(true)
      expect(ts.isPropertyAccessExpression(property.initializer)).toBe(true)
      expect(property.initializer.name.text).toBe(field)
    }
  })
})
