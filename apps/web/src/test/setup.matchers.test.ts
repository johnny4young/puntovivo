import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
});

describe('DOM matcher bridge', () => {
  it('registers real matchers and preserves synchronous return types', () => {
    const button = document.createElement('button');
    button.disabled = true;
    document.body.append(button);

    expectTypeOf(expect(button).toBeInTheDocument()).toEqualTypeOf<void>();
    expect(button).toBeDisabled();
    expect({ element: button }).toEqual({ element: expect.toBeInTheDocument() });
  });

  it('preserves async matcher return types and awaits their assertions', async () => {
    const element = document.createElement('div');
    document.body.append(element);

    const assertion = expect(Promise.resolve(element)).resolves.toBeInTheDocument();
    expectTypeOf(assertion).toEqualTypeOf<Promise<void>>();
    await assertion;
  });

  it('still fails when a detached element is asserted to be in the document', () => {
    const detached = document.createElement('div');
    expect(detached).not.toBeInTheDocument();
    expect(() => expect(detached).toBeInTheDocument()).toThrow();
  });
});
