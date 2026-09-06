// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Supervision from './Supervision';
import { DEV_WORLD_FIXTURE } from './devFixture';
afterEach(cleanup);
const props = { agents: DEV_WORLD_FIXTURE.agents, kanban: DEV_WORLD_FIXTURE.kanban, events: [], onSelect: vi.fn(), mode: 'agents', setMode: vi.fn(), filter: 'all', setFilter: vi.fn(), overflowIds: new Set<string>() };
describe('usable supervision', () => {
  it('isolates real all and unassigned IDs from filter sentinels', () => {
    render(<Supervision {...props} mode="kanban" kanban={{ partial: false, tasks: [
      { board_slug: 'all', task_id: '1', title: 'Reserved name', status: 'ready', assignee: 'unassigned' },
      { board_slug: 'other', task_id: '2', title: 'Other task', status: 'ready', assignee: null },
    ] }} />);
    fireEvent.change(screen.getByLabelText('Filtrer par board'), { target: { value: 'all' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Filtrer par assignation'), { target: { value: 'unassigned' } });
    expect(screen.getByText('Reserved name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrer par assignation'), { target: { value: '!unassigned' } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('searches the team and keeps overflow accessible', () => {
    render(<Supervision {...props} overflowIds={new Set(['fixture-1'])} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Atlas' } });
    expect(screen.getByRole('heading', { name: /1 résultats/ })).toBeInTheDocument();
    expect(screen.getByText(/hors scène/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atlas Run/ }));
    expect(props.onSelect).toHaveBeenCalledWith('fixture-1');
  });
  it('shows readable task titles and exact board references', () => {
    render(<Supervision {...props} mode="kanban" />);
    expect(screen.getByText('Tester le poste dynamique')).toBeInTheDocument();
    expect(screen.getByText('local-test · fixture-task')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Supervision détaillée' })).getByRole('button', { name: /Voir les preuves/ })).toBeEnabled();
  });
  it('combines board, status and assignment filters without changing the source cards', () => {
    const kanban = { partial: false, tasks: [
      { board_slug: 'alpha', task_id: '1', title: 'Libre', status: 'ready', assignee: null },
      { board_slug: 'beta', task_id: '2', title: 'En cours', status: 'running', assignee: 'atlas' },
      { board_slug: 'alpha', task_id: '3', title: 'Triage', status: 'triage', assignee: 'atlas' },
    ] };
    render(<Supervision {...props} mode="kanban" kanban={kanban} />);
    fireEvent.change(screen.getByLabelText('Filtrer par board'), { target: { value: 'alpha' } });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Filtrer les cartes par statut'), { target: { value: 'blocked' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Triage')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrer par assignation'), { target: { value: '!unassigned' } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(kanban.tasks).toHaveLength(3);
  });
});
