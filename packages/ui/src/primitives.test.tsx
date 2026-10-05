import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryBoundary, SourceBadge, Chip } from './primitives';

describe('QueryBoundary — loading / empty / error / permission-denied / stale', () => {
  it('renders each state', () => {
    const { rerender } = render(<QueryBoundary status="pending">x</QueryBoundary>); expect(screen.getByTestId('loading')).toBeTruthy();
    rerender(<QueryBoundary status="error" error={{ status: 403, message: 'no' }}>x</QueryBoundary>); expect(screen.getByTestId('forbidden')).toBeTruthy();
    rerender(<QueryBoundary status="error" error={{ status: 500, message: 'boom' }}>x</QueryBoundary>); expect(screen.getByTestId('error').textContent).toMatch(/boom/);
    rerender(<QueryBoundary status="success" isEmpty empty="No jobs">x</QueryBoundary>); expect(screen.getByTestId('empty').textContent).toBe('No jobs');
    rerender(<QueryBoundary status="success" stale>data</QueryBoundary>); expect(screen.getByTestId('stale')).toBeTruthy();
  });
  it('estimated tracking events are visibly different from actuals', () => {
    render(<><SourceBadge source="carrier" actual /><SourceBadge source="inferred" actual={false} /><Chip tone="hold">Customs hold</Chip></>);
    const [a, e] = screen.getAllByTestId('source-badge'); expect(a.textContent).toBe('carrier'); expect(e.textContent).toMatch(/^estimated/);
  });
});
