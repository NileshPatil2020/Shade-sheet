import test from 'node:test';
import assert from 'node:assert/strict';

test('shade key generation is unique', () => {
  const shade = { brand: 'Asian Paints', name: 'Abyss', code: '8365' };
  const key = `${shade.brand}|${shade.name}|${shade.code}`;
  assert.equal(key, 'Asian Paints|Abyss|8365');
});

test('shade filter matches query accurately', () => {
  const shades = [
    { brand: 'Asian Paints', name: 'Abyss', code: '8365', family: 'Green', hex: '#358240' },
    { brand: 'Nerolac', name: 'Apple Green', code: '02585', family: 'Green', hex: '#38B74B' },
    { brand: 'Birla Opus', name: 'Almond Toast', code: '4647', family: 'Brown', hex: '#B28A68' }
  ];

  const query = 'apple';
  const filtered = shades.filter(s =>
    [s.name, s.code, s.brand, s.family, s.hex].join(' ').toLowerCase().includes(query)
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'Apple Green');
});

test('brand display names map properly', () => {
  const displayBrandName = (brand: string) =>
    brand === 'Berger' ? 'Berger Paints' : brand === 'Tinting colour' ? 'Tinting colours' : brand;

  assert.equal(displayBrandName('Berger'), 'Berger Paints');
  assert.equal(displayBrandName('Tinting colour'), 'Tinting colours');
  assert.equal(displayBrandName('Nerolac'), 'Nerolac');
});
