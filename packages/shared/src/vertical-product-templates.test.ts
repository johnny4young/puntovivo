import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERTICAL_PRODUCT_TEMPLATE_IDS,
  VERTICAL_PRODUCT_TEMPLATES,
  getVerticalProductTemplate,
} from './vertical-product-templates.ts';
import { isProductTemplateVerticalId } from './vertical-presets.ts';

test('only hardware and butchery expose vertical product templates', () => {
  assert.equal(isProductTemplateVerticalId('hardware'), true);
  assert.equal(isProductTemplateVerticalId('butchery'), true);
  assert.equal(isProductTemplateVerticalId('retail'), false);
  assert.equal(isProductTemplateVerticalId(null), false);
});

test('every template id is unique and resolves to an explicit form-only contract', () => {
  assert.equal(new Set(VERTICAL_PRODUCT_TEMPLATE_IDS).size, VERTICAL_PRODUCT_TEMPLATE_IDS.length);
  assert.equal(VERTICAL_PRODUCT_TEMPLATES.length, VERTICAL_PRODUCT_TEMPLATE_IDS.length);
  for (const id of VERTICAL_PRODUCT_TEMPLATE_IDS) {
    const template = getVerticalProductTemplate(id);
    assert.equal(template.id, id);
    assert.ok(template.preferredUnitAbbreviations.length > 0);
    assert.ok(['count', 'length', 'mass'].includes(template.requiredUnitDimension));
  }
});

test('weighted cuts use thousandths, lots and a kilogram unit without becoming serialized', () => {
  const template = getVerticalProductTemplate('butchery-weighted-cut');
  assert.equal(template.fractionStep, 0.001);
  assert.equal(template.fractionMinimum, 0.001);
  assert.equal(template.tracksLots, true);
  assert.equal(template.tracksSerials, false);
  assert.equal(template.preferredUnitAbbreviations[0], 'KG');
  assert.equal(template.requiredUnitDimension, 'mass');
});

test('hardware serialization remains whole-unit and mutually exclusive with lot tracking', () => {
  const template = getVerticalProductTemplate('hardware-serialized');
  assert.equal(template.sellByFraction, false);
  assert.equal(template.tracksSerials, true);
  assert.equal(template.tracksLots, false);
});
