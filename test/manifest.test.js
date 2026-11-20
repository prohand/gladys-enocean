// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest shape; only these tests can know
// which handlers the code registers and which defaults it uses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createSceneActions } from '../src/capabilities/scenes.js';
import { createWidgets } from '../src/capabilities/widget.js';
import { ROCKER_BUTTONS, HANDLE_POSITIONS } from '../src/enocean/eep.js';
import { LANGUAGES } from '../src/i18n.js';
import { TRIGGERS } from '../src/runtime.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const indexSource = await read('../index.js');

const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
    ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
  ];
}

/** Every multi-language text of the manifest, with where it sits. */
function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, child] of node.entries()) {
      yield* texts(child, `${path}[${i}]`);
    }
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (['label', 'description', 'placeholder'].includes(key)) {
      yield [`${path}.${key}`, value];
    } else {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the version matches package.json and tags the docker image', () => {
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.docker_image, new RegExp(`^ghcr\\.io/[^:]+:${pkg.version}$`));
});

test('the description fits what the store allows, in four languages', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.deepEqual(Object.keys(manifest.description).sort(), [...LANGUAGES].sort());
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${language}: ${text.length}`);
  }
});

test('every text of the manifest is written in en, fr, de and es', () => {
  for (const [path, value] of texts(manifest)) {
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    for (const language of LANGUAGES) {
      assert.ok(value[language], `${path} has no "${language}"`);
    }
  }
});

test('every field uses a type the store accepts', () => {
  for (const field of allFields()) {
    assert.ok(FIELD_TYPES.includes(field.type), `${field.key}: type ${field.type}`);
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `${field.key}: min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `${field.key}: source and options together`);
    }
  }
});

test('config_schema and DEFAULT_CONFIG agree', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores nothing`);
      assert.equal(field.default, undefined);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key ${field.key} unknown to the code`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
  for (const link of manifest.config_schema.flatMap((f) => f.links ?? [])) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions) {
    assert.match(indexSource, new RegExp(`onAction\\('${action.key}'`), action.key);
  }
});

test('scene actions, widgets and triggers match the code', () => {
  const runtime = { devices: [], heard: { list: () => [] }, configErrors: [] };
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.keys(createSceneActions(runtime)).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key).sort(),
    Object.keys(createWidgets(runtime)).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.match(indexSource, /onSceneAction\(/);
  assert.match(indexSource, /onWidgetGet\(/);
  assert.match(indexSource, /onWidgetAction\(/);
});

test('trigger and action options match the values the code sends', () => {
  const rocker = manifest.scene_triggers.find((t) => t.key === TRIGGERS.ROCKER_PRESSED);
  const buttons = rocker.fields.find((f) => f.key === 'button').options.map((o) => o.value);
  assert.deepEqual([...buttons].sort(), [...ROCKER_BUTTONS].sort());
  const handle = manifest.scene_triggers.find((t) => t.key === TRIGGERS.WINDOW_HANDLE_MOVED);
  const positions = handle.fields.find((f) => f.key === 'position').options.map((o) => o.value);
  assert.deepEqual(positions, HANDLE_POSITIONS);
  const press = manifest.scene_actions.find((a) => a.key === 'press_rocker');
  const pressButtons = press.fields.find((f) => f.key === 'button').options.map((o) => o.value);
  assert.deepEqual([...pressButtons].sort(), [...ROCKER_BUTTONS].sort());
});

test('categories stay inside the store vocabulary', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(CATEGORIES.includes(category), category);
  }
});

test('transports, keywords and countries have the shape the store accepts', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const keywords = manifest.keywords.map((k) => k.trim().toLowerCase());
  assert.equal(new Set(keywords).size, keywords.length);
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
  assert.ok(manifest.countries.length >= 1 && manifest.countries.length <= 20);
  assert.equal(new Set(manifest.countries).size, manifest.countries.length);
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
});

test('the Gladys floor covers every field the manifest declares', () => {
  // widgets and scenes need 5.1, keywords and countries 5.3: older cores
  // reject an unknown manifest field.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 3), manifest.gladys_version);
});

test('the widget label and description fit the store bounds', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, text);
    }
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const doc = await read(`../docs/${language}.md`);
    assert.ok(doc.length > 500, `docs/${language}.md is too short`);
    assert.match(doc, /ser2net/);
  }
});
