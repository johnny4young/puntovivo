import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function methodParameters(relativePath: string, interfaceName: string) {
  const path = new URL(relativePath, import.meta.url);
  const source = ts.createSourceFile(
    path.pathname,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  );
  assert.ok(declaration, `${relativePath}: missing ${interfaceName}`);
  return Object.fromEntries(
    declaration.members.map(member => {
      assert.ok(ts.isPropertySignature(member) && member.type);
      assert.ok(ts.isFunctionTypeNode(member.type));
      return [
        member.name.getText(source),
        member.type.parameters.map(parameter => ({
          name: parameter.name.getText(source),
          type: parameter.type?.getText(source),
          optional: !!parameter.questionToken,
        })),
      ];
    })
  );
}

for (const name of ['SyncAPI']) {
  test(`${name} renderer declarations match the session-bound preload parameters`, () => {
    const implementation = methodParameters('../../preload/index.ts', name);
    assert.deepEqual(methodParameters('../../preload/index.d.ts', name), implementation);
    assert.deepEqual(
      methodParameters('../../../../web/src/types/electron.ts', name),
      implementation
    );
  });
}

for (const path of [
  '../../preload/index.ts',
  '../../preload/index.d.ts',
  '../../../../web/src/types/electron.ts',
]) {
  test(`${path} declares no removed DatabaseAPI`, () => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.equal(source.includes('DatabaseAPI'), false);
  });
}
