import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHTML,
    getRefereeEligibleTeams,
    limitSelectedReferees,
    mergeStudent,
    normalizeGender,
    validateMissions
} from '../app-utils.js';

test('escapeHTML escapes markup and attribute delimiters', () => {
    assert.equal(escapeHTML(`<img src="x" onerror='bad'>`), '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;');
});

test('mergeStudent preserves game data while updating roster fields', () => {
    const existing = { no: 1, name: '이전이름', gender: '남', score: 7, customAvatar: 'avatar.png', isReferee: true };
    const merged = mergeStudent(existing, { no: 1, name: '새이름', gender: '여' });
    assert.equal(merged.name, '새이름');
    assert.equal(merged.gender, '여');
    assert.equal(merged.score, 7);
    assert.equal(merged.customAvatar, 'avatar.png');
    assert.equal(merged.isReferee, true);
});

test('normalizeGender rejects unexpected spreadsheet values', () => {
    assert.equal(normalizeGender('남'), '남');
    assert.equal(normalizeGender('기타'), '-');
});

test('validateMissions rejects empty and zero-weight roulettes', () => {
    assert.equal(validateMissions([]).valid, false);
    assert.equal(validateMissions([{ text: '미션', desc: '', color: '#ffffff', weight: 0 }]).valid, false);
});

test('validateMissions normalizes valid missions', () => {
    const result = validateMissions([{ text: ' 미션 ', desc: ' 설명 ', color: 'invalid', weight: '10' }]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.missions[0], { text: '미션', desc: '설명', color: '#74b9ff', weight: 10 });
});

test('limitSelectedReferees replaces enough referees to satisfy the limit', () => {
    const picked = [1, 2, 3, 4].map((no) => ({ no, isReferee: true }));
    const remaining = [{ no: 5, isReferee: false }, { no: 6, isReferee: false }];
    const result = limitSelectedReferees(picked, remaining, 2);
    assert.equal(result.filter((student) => student.isReferee).length, 2);
    assert.deepEqual(result.map((student) => student.no).sort(), [1, 2, 5, 6]);
});

test('limitSelectedReferees keeps at most one referee in an individual match', () => {
    const picked = [1, 2, 3].map((no) => ({ no, isReferee: true }));
    const remaining = [{ no: 4, isReferee: false }, { no: 5, isReferee: false }];
    const result = limitSelectedReferees(picked, remaining, 1);
    assert.equal(result.filter((student) => student.isReferee).length, 1);
});

test('limitSelectedReferees removes excess referees when no replacement exists', () => {
    const result = limitSelectedReferees([
        { no: 1, isReferee: true },
        { no: 2, isReferee: true }
    ], [], 1);
    assert.deepEqual(result.map((student) => student.no), [1]);
});

test('getRefereeEligibleTeams keeps referees out of the opposing team', () => {
    const referee = { no: 1, isReferee: true };
    const teams = [
        { id: 1, members: [referee], targetSize: 3 },
        { id: 2, members: [], targetSize: 3 },
        { id: 3, members: [], targetSize: 3 },
        { id: 4, members: [], targetSize: 3 }
    ];
    assert.deepEqual(getRefereeEligibleTeams(teams).map((team) => team.id), [3, 4]);
});
