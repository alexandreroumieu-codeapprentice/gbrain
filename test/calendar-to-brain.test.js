import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fixture from '../integrations/calendar-to-brain/fixtures/mock-response.json';
import {
  normalizeEvents,
  groupEventsByDay,
  renderDayMarkdown,
  buildRequestedWindow,
  buildStdoutSummary,
  parseArgs,
  writeDayFiles,
} from '../integrations/calendar-to-brain/collector.mjs';

describe('calendar-to-brain collector', () => {
  test('normalizes fixture, skips cancelled events, and groups by day', () => {
    const events = normalizeEvents(fixture);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.id)).toEqual(['evt_all_day', 'evt_timed_1', 'evt_timed_2']);

    const grouped = groupEventsByDay(events);
    expect([...grouped.keys()]).toEqual(['2026-05-10', '2026-05-11']);
    expect(grouped.get('2026-05-10').map((event) => event.id)).toEqual(['evt_all_day', 'evt_timed_1']);
  });

  test('renders markdown with explicit redacted source, French human date, and no leaked emails', () => {
    const events = normalizeEvents(fixture);
    const grouped = groupEventsByDay(events);
    const serviceId = ['google.calendar', 'fixture-user'].join(':');
    const markdown = renderDayMarkdown('2026-05-10', grouped.get('2026-05-10'), {
      collectedAt: '2026-05-09T00:00:00.000Z',
      serviceId,
      range: buildRequestedWindow('2026-05-10', '2026-05-11'),
    });

    expect(markdown).toContain('title: Google Calendar 2026-05-10 (10 mai 2026)');
    expect(markdown).toContain('human_date: 10 mai 2026');
    expect(markdown).toContain('# Google Calendar — 2026-05-10 (10 mai 2026)');
    expect(markdown).toContain('Date humaine: 10 mai 2026');
    expect(markdown).toContain('service: google.calendar:[redacted]');
    expect(markdown).toContain('Source: ClawVisor Google Calendar (google.calendar:[redacted])');
    expect(markdown).not.toContain(serviceId);
    expect(markdown).not.toContain('fixture-user');
    expect(markdown).toContain('All day **Offsite équipe**');
    expect(markdown).toContain('09:00-09:30 **Point dossier X**');
    expect(markdown).toContain('Attendees: Alice Martin, Bob Durant');
    expect(markdown).not.toContain('@');
  });

  test('preview prints redacted markdown without enabling writes', () => {
    const events = normalizeEvents(fixture);
    const grouped = groupEventsByDay(events);
    const serviceId = ['google.calendar', 'fixture-user'].join(':');
    const summary = buildStdoutSummary({
      eventsByDay: grouped,
      write: false,
      outputRoot: '/tmp/brain/sources/google-calendar',
      taskId: 'task-123',
      taskStatus: 'active',
      preview: true,
      collectedAt: '2026-05-09T00:00:00.000Z',
      serviceId,
      range: buildRequestedWindow('2026-05-10', '2026-05-11'),
    });

    expect(summary).toContain('Mode: dry-run');
    expect(summary).toContain('No files written.');
    expect(summary).toContain('--- Markdown preview ---');
    expect(summary).toContain('service: google.calendar:[redacted]');
    expect(summary).not.toContain(serviceId);
    expect(summary).not.toContain('fixture-user');
    expect(summary).not.toContain('@');
  });

  test('write skips existing files unless overwrite is explicit', () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-to-brain-test-'));
    try {
      const events = normalizeEvents(fixture);
      const grouped = groupEventsByDay(events);
      const meta = {
        outputRoot,
        collectedAt: '2026-05-09T00:00:00.000Z',
        serviceId: ['google.calendar', 'fixture-user'].join(':'),
        range: buildRequestedWindow('2026-05-10', '2026-05-11'),
      };

      const first = writeDayFiles(grouped, meta);
      expect(first.writtenFiles).toHaveLength(2);
      expect(first.skippedFiles).toHaveLength(0);

      const target = path.join(outputRoot, '2026', '2026-05-10.md');
      fs.writeFileSync(target, 'sentinel\n');

      const second = writeDayFiles(grouped, meta);
      expect(second.writtenFiles).toHaveLength(0);
      expect(second.skippedFiles).toHaveLength(2);
      expect(fs.readFileSync(target, 'utf8')).toBe('sentinel\n');

      const third = writeDayFiles(grouped, { ...meta, overwrite: true });
      expect(third.writtenFiles).toHaveLength(2);
      expect(third.skippedFiles).toHaveLength(0);
      expect(fs.readFileSync(target, 'utf8')).toContain('# Google Calendar — 2026-05-10 (10 mai 2026)');
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test('CLI defaults stay safe and preview/overwrite are opt-in', () => {
    const args = parseArgs(['--mock']);
    expect(args.dryRun).toBe(true);
    expect(args.write).toBe(false);
    expect(args.preview).toBeUndefined();
    expect(args.overwrite).toBeUndefined();
    expect(args.maxResults).toBe(3);
    expect(args.from).toBeTruthy();
    expect(args.to).toBeTruthy();

    const previewArgs = parseArgs(['--mock', '--preview']);
    expect(previewArgs.dryRun).toBe(true);
    expect(previewArgs.write).toBe(false);
    expect(previewArgs.preview).toBe(true);

    const overwriteArgs = parseArgs(['--mock', '--write', '--overwrite']);
    expect(overwriteArgs.dryRun).toBe(false);
    expect(overwriteArgs.write).toBe(true);
    expect(overwriteArgs.overwrite).toBe(true);
  });
});
