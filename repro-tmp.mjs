import { buildRecurrenceFromConfig, getNextOccurrence } from './src/services/task.service';
const cfg = { enabled: true, frequency: 'day', interval: 1, weekdays: ['monday','tuesday','wednesday','thursday','saturday','sunday'], startsAt: '2026-08-13', endsType: 'never', repeatBasedOn: 'dueDate' };
const r = buildRecurrenceFromConfig(cfg, new Date('2026-08-13'));
console.log('RULE:', r.recurrenceRule, 'DUEDATE:', r.dueDate?.toISOString());
for (const d of ['2026-08-13','2026-08-14']) {
  const n = getNextOccurrence(new Date(d), r.recurrenceRule, null, []);
  console.log('from', d, '-> next', n ? n.toISOString().split('T')[0] : 'null');
}
