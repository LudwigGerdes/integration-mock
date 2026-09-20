import { describe, it, expect } from 'vitest';
import { FaultController } from '../src/faults.js';

describe('FaultController', () => {
	it('applies immediately and persists', () => {
		const f = new FaultController();
		f.set('slack', { status: 500 });
		expect(f.next('slack')).toEqual({ status: 500 });
		expect(f.next('slack')).toEqual({ status: 500 });
		expect(f.next('other')).toBeNull();
	});

	it('after:2 once:true → null,null,fault,null', () => {
		const f = new FaultController();
		f.set('s', { status: 503, after: 2, once: true });
		expect(f.next('s')).toBeNull();
		expect(f.next('s')).toBeNull();
		expect(f.next('s')?.status).toBe(503);
		expect(f.next('s')).toBeNull();
		expect(f.snapshot()).toEqual({});
	});

	it('after without once persists after threshold', () => {
		const f = new FaultController();
		f.set('s', { status: 429, after: 1 });
		expect(f.next('s')).toBeNull();
		expect(f.next('s')?.status).toBe(429);
		expect(f.next('s')?.status).toBe(429);
	});

	it('clear one / all; snapshot reflects state', () => {
		const f = new FaultController();
		f.set('a', { empty: true });
		f.set('b', { delayMs: 10 });
		expect(f.snapshot()).toEqual({ a: { empty: true }, b: { delayMs: 10 } });
		f.clear('a');
		expect(f.snapshot()).toEqual({ b: { delayMs: 10 } });
		f.clear();
		expect(f.snapshot()).toEqual({});
	});
});
