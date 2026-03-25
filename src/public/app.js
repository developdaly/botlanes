import { h, render, Component } from 'https://esm.sh/preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'https://esm.sh/preact/hooks';
import htm from 'https://esm.sh/htm';

const html = htm.bind(h);

const BASE_PATH = window.MC_BASE_PATH || '';

const STATUS_COLORS = {
  idle: '#6B7280',
  pending: '#F59E0B',
  running: '#3B82F6',
  awaiting_human: '#F97316',
  complete: '#10B981',
  failed: '#EF4444',
};

const STATUS_LABELS = {
  idle: 'Idle',
  pending: 'Pending',
  running: 'Running',
  awaiting_human: 'Awaiting Human',
  complete: 'Complete',
  failed: 'Failed',
};

const ACTIVITY_META = {
  card_created: { icon: '✦', family: 'system', label: 'System' },
  session_linked: { icon: '⇄', family: 'system', label: 'System' },
  run_started: { icon: '▶', family: 'system', label: 'Run' },
  run_completed: { icon: '✓', family: 'system', label: 'Run' },
  run_failed: { icon: '✕', family: 'system', label: 'Run' },
  run_cancelled: { icon: '■', family: 'system', label: 'Run' },
  stage_changed: { icon: '→', family: 'stage', label: 'Stage' },
  status_changed: { icon: '●', family: 'status', label: 'Status' },
  agent_comment: { icon: '💬', family: 'agent', label: 'Agent' },
  human_comment: { icon: '💬', family: 'human', label: 'Human' },
  agent_question: { icon: '⁉', family: 'agent', label: 'Agent' },
  human_reply: { icon: '↩', family: 'human', label: 'Human' },
  unknown_event: { icon: '•', family: 'system', label: 'System' },
};

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function apiFetch(url, options = {}) {
  const res = await fetch(BASE_PATH + url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  if (res.status === 401) {
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'HTTP ' + res.status);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function formatActivityTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const year = d.getFullYear();
    if (d.toDateString() !== now.toDateString()) {
      return month + ' ' + day + (year !== now.getFullYear() ? ', ' + year : '') + ' ' + time;
    }
    return time;
  } catch { return ''; }
}

function formatActivityDayLabel(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    const parts = [
      d.toLocaleString('en-US', { weekday: 'short' }),
      d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getDate(),
    ];
    if (d.getFullYear() !== now.getFullYear()) parts.push(String(d.getFullYear()));
    return parts.join(', ');
  } catch {
    return '';
  }
}

function statusLabel(value) {
  if (!value) return 'Unknown status';
  return STATUS_LABELS[value] || String(value).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function App() {
  const [boardState, setBoardState] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [pollOk, setPollOk] = useState(true);
  const [activeCardId, setActiveCardId] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [preselectedProjectId, setPreselectedProjectId] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('mc_collapsed_projects') || '{}');
    } catch { return {}; }
  });

  const columns = boardState?.columns || [];

  const refreshState = useCallback(async () => {
    try {
      const state = await apiFetch('/api/state');
      setBoardState(state);
      setPollOk(true);
      setIsAuthorized(true);
    } catch (err) {
      if (err.message === 'Unauthorized') {
        setIsAuthorized(false);
      } else {
        console.error('Poll error:', err);
        setPollOk(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshState();
    const interval = setInterval(refreshState, 2000);
    return () => clearInterval(interval);
  }, [refreshState]);

  useEffect(() => {
    localStorage.setItem('mc_collapsed_projects', JSON.stringify(collapsedProjects));
  }, [collapsedProjects]);

  const toggleProjectCollapse = (projectId) => {
    setCollapsedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }));
  };

  const moveCard = async (cardId, columnId, targetProjectId) => {
    const card = boardState.cards.find(c => c.id === cardId);
    if (!card) return;

    let updated = false;
    if (targetProjectId !== undefined) {
      const currentProjectId = card.projectId || null;
      if (currentProjectId !== (targetProjectId === 'null' ? null : targetProjectId)) {
        try {
          await apiFetch(`/api/cards/${cardId}`, {
            method: 'PATCH',
            body: JSON.stringify({ projectId: targetProjectId === 'null' ? null : targetProjectId }),
          });
          updated = true;
        } catch (err) {
          alert('Failed to move card to project: ' + err.message);
          return;
        }
      }
    }

    if (card.column !== columnId) {
      try {
        await apiFetch(`/api/cards/${cardId}/move`, {
          method: 'POST',
          body: JSON.stringify({ column: columnId }),
        });
        updated = true;
      } catch (err) {
        if (err.message !== 'Unauthorized') {
          alert('Failed to move card: ' + err.message);
        }
      }
    }

    if (updated) refreshState();
  };

  if (!isAuthorized) {
    return html`<${LoginPage} onLogin=${() => { setIsAuthorized(true); refreshState(); }} />`;
  }

  const activeCard = boardState?.cards?.find(c => c.id === activeCardId);

  return html`
    <div class="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden">
      <${Header} 
        pollOk=${pollOk} 
        onAddCard=${() => { setPreselectedProjectId(null); setIsAddModalOpen(true); }}
        onManageProjects=${() => setIsProjectModalOpen(true)}
      />
      <div id="board-container" class="flex-1 overflow-auto">
        <${Board} 
          boardState=${boardState} 
          collapsedProjects=${collapsedProjects}
          onToggleCollapse=${toggleProjectCollapse}
          onCardClick=${(id) => setActiveCardId(id)}
          onMoveCard=${moveCard}
          onAddCardToProject=${(projectId) => { setPreselectedProjectId(projectId); setIsAddModalOpen(true); }}
        />
      </div>

      <${CardModal} 
        card=${activeCard} 
        columns=${columns}
        projects=${boardState?.projects || []}
        onClose=${() => setActiveCardId(null)} 
        onRefresh=${refreshState}
      />

      <${AddCardModal} 
        isOpen=${isAddModalOpen} 
        projects=${boardState?.projects || []}
        preselectedProjectId=${preselectedProjectId}
        onClose=${() => setIsAddModalOpen(false)} 
        onRefresh=${refreshState}
      />

      <${ProjectManagerModal}
        isOpen=${isProjectModalOpen}
        projects=${boardState?.projects || []}
        onClose=${() => setIsProjectModalOpen(false)}
        onRefresh=${refreshState}
      />
    </div>
  `;
}

function Header({ pollOk, onAddCard, onManageProjects }) {
  return html`
    <header class="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-800 flex-shrink-0" style="height:56px;">
      <div class="flex items-center gap-4">
        <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
          </svg>
        </div>
        <div>
          <h1 class="text-sm font-bold text-white leading-tight">Botlanes</h1>
          <p class="text-xs text-slate-500 leading-tight">Mission Control</p>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <span class="w-2 h-2 rounded-full ${pollOk ? 'bg-emerald-500' : 'bg-red-500'}" title="${pollOk ? 'Connected' : 'Connection Error'}"></span>
        <button class="btn btn-secondary text-sm" style="padding:6px 14px;" onClick=${onManageProjects}>
          Manage Projects
        </button>
        <button class="btn btn-primary text-sm" style="padding:6px 14px;" onClick=${onAddCard}>
          <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Card
        </button>
      </div>
    </header>
  `;
}

function Board({ boardState, collapsedProjects, onToggleCollapse, onCardClick, onMoveCard, onAddCardToProject }) {
  if (!boardState) return null;

  const projects = [{ id: 'null', name: 'Global (No Project)' }, ...(boardState.projects || [])];
  const columns = boardState.columns || [];

  const cardsByProjectCol = useMemo(() => {
    const map = {};
    projects.forEach(p => {
      map[p.id] = {};
      columns.forEach(c => { map[p.id][c.id] = []; });
    });
    (boardState.cards || []).forEach(card => {
      const pId = card.projectId || 'null';
      const colId = card.column || 'backlog';
      if (map[pId] && map[pId][colId]) {
        map[pId][colId].push(card);
      }
    });
    return map;
  }, [projects, columns, boardState.cards]);

  return html`
    <main id="board" style="grid-template-columns: var(--sidebar-width) repeat(${columns.length}, var(--column-width));">
      <div class="grid-header grid-header--sticky">Project</div>
      ${columns.map(col => html`<div class="grid-header">${col.name}</div>`)}

      ${projects.map(project => {
        const isCollapsed = !!collapsedProjects[project.id];
        const projectCards = (boardState.cards || []).filter(c => (c.projectId || 'null') === project.id);
        
        return html`
          <div class="project-row ${isCollapsed ? 'collapsed' : ''}">
            <div class="project-header-cell" onClick=${() => onToggleCollapse(project.id)}>
              <svg class="project-chevron w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
              <span class="project-header-name">${project.name}</span>
              <span class="project-card-count">${projectCards.length}</span>
            </div>
            ${columns.map(col => html`
              <${ColumnCell} 
                project=${project} 
                column=${col} 
                cards=${cardsByProjectCol[project.id][col.id]}
                onCardClick=${onCardClick}
                onMoveCard=${onMoveCard}
                onAddCard=${() => onAddCardToProject(project.id === 'null' ? null : project.id)}
              />
            `)}
          </div>
        `;
      })}
    </main>
  `;
}

function ColumnCell({ project, column, cards, onCardClick, onMoveCard, onAddCard }) {
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => {
    setIsDragOver(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId) {
      onMoveCard(cardId, column.id, project.id);
    }
  };

  const isEmptyBacklog = column.id === 'backlog' && cards.length === 0;

  return html`
    <div 
      class="project-cell ${isDragOver ? 'drag-over' : ''}" 
      onDragOver=${onDragOver}
      onDragLeave=${onDragLeave}
      onDrop=${onDrop}
      data-column-name="${column.name}"
    >
      ${isEmptyBacklog ? html`
        <div class="empty-dropzone" onClick=${(e) => { e.stopPropagation(); onAddCard(); }}>
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span>+ Add first card</span>
        </div>
      ` : cards.map(card => html`<${Card} key=${card.id} card=${card} onClick=${() => onCardClick(card.id)} />`)}
    </div>
  `;
}

function Card({ card, onClick }) {
  const [isDragging, setIsDragging] = useState(false);

  const onDragStart = (e) => {
    setIsDragging(true);
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragEnd = () => {
    setIsDragging(false);
  };

  const status = card.status || 'idle';
  const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const runningClass = status === 'running' ? ' running' : '';
  const needsPatrick = card.attentionMode === 'waiting_on_patrick' || (card.derived && card.derived.attentionLevel === 'patrick');

  return html`
    <div 
      class="card ${isDragging ? 'dragging' : ''} ${needsPatrick ? 'card--needs-patrick' : ''} ${status === 'awaiting_human' ? 'awaiting-human' : ''}"
      draggable="true"
      onDragStart=${onDragStart}
      onDragEnd=${onDragEnd}
      onClick=${onClick}
    >
      <div class="flex items-start gap-2">
        <span class="status-dot${runningClass}" style="background:${color};margin-top:5px;flex-shrink:0;"></span>
        <span class="text-sm font-medium text-gray-100 leading-snug flex-1">${card.title || 'Untitled'}</span>
        <${AttentionChip} card=${card} />
      </div>
      <${AttentionPill} card=${card} />
      ${status === 'awaiting_human' && card.attentionReason && html`
        <div class="question-preview">⁉️ ${card.attentionReason.length > 120 ? card.attentionReason.slice(0, 120) + '…' : card.attentionReason}</div>
      `}
      ${card.tags && card.tags.length > 0 && html`
        <div class="flex flex-wrap mt-2">
          ${card.tags.map(t => html`<span class="tag-badge">${t}</span>`)}
        </div>
      `}
      ${card.skillTriggered && html`
        <div class="text-xs text-blue-400 font-mono mt-2 truncate">${card.skillTriggered}</div>
      `}
    </div>
  `;
}

function AttentionChip({ card }) {
  const derived = card.derived || {};
  const unreadCommentCount = Number(derived.unreadCommentCount || 0);
  const hasUnreadOutput = !!derived.hasUnreadOutput;
  const needsPatrick = card.attentionMode === 'waiting_on_patrick' || derived.attentionLevel === 'patrick';

  if (needsPatrick) {
    if (unreadCommentCount > 0) {
      const label = unreadCommentCount === 1 ? '1 unread comment' : (unreadCommentCount > 9 ? '9+' : unreadCommentCount) + ' unread comments';
      return html`<span class="attention-chip attention-chip--comments" title="${label}">${unreadCommentCount > 9 ? '9+' : unreadCommentCount}</span>`;
    }
    return null;
  }

  if (unreadCommentCount > 0) {
    const label = unreadCommentCount === 1 ? '1 unread comment' : (unreadCommentCount > 9 ? '9+' : unreadCommentCount) + ' unread comments';
    return html`<span class="attention-chip attention-chip--comments" title="${label}">${unreadCommentCount > 9 ? '9+' : unreadCommentCount}</span>`;
  }

  if (hasUnreadOutput) {
    return html`<span class="attention-chip attention-chip--output" title="New unread output"></span>`;
  }

  return null;
}

function AttentionPill({ card }) {
  const derived = card.derived || {};
  const needsPatrick = card.attentionMode === 'waiting_on_patrick' || derived.attentionLevel === 'patrick';
  if (!needsPatrick) return null;
  const label = card.status === 'awaiting_human' ? 'Awaiting Human' : 'Needs Patrick';
  return html`
    <div class="attention-pill-row">
      <span class="attention-pill" title="${card.attentionReason || ''}">${label}</span>
    </div>
  `;
}

function CardModal({ card, columns, projects, onClose, onRefresh }) {
  if (!card) return null;

  const [activity, setActivity] = useState([]);
  const [logContent, setLogContent] = useState('');
  const [isLogVisible, setIsLogVisible] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReplying, setIsReplying] = useState(false);

  // Edit states
  const [title, setTitle] = useState(card.title || '');
  const [description, setDescription] = useState(card.description || '');
  const [tags, setTags] = useState((card.tags || []).join(', '));
  const [attentionMode, setAttentionMode] = useState(card.attentionMode || 'none');
  const [attentionReason, setAttentionReason] = useState(card.attentionReason || '');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);

  useEffect(() => {
    setTitle(card.title || '');
    setDescription(card.description || '');
    setTags((card.tags || []).join(', '));
    setAttentionMode(card.attentionMode || 'none');
    setAttentionReason(card.attentionReason || '');
    setLogContent('');
    setIsLogVisible(false);
    setActivity([]);
    loadActivity();
    markRead();
  }, [card.id]);

  const loadActivity = async () => {
    try {
      const data = await apiFetch(`/api/cards/${card.id}/activity`);
      setActivity(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load activity', err);
    }
  };

  const markRead = async () => {
    try {
      await apiFetch(`/api/cards/${card.id}/read`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to mark as read', err);
    }
  };

  const saveEdits = async () => {
    setIsSaving(true);
    try {
      const isAwaitingHuman = card.status === 'awaiting_human';
      const payload = {
        title: title.trim(),
        description: description.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean)
      };
      if (!isAwaitingHuman) {
        payload.attentionMode = attentionMode;
        payload.attentionReason = attentionMode === 'waiting_on_patrick' ? attentionReason.trim() : null;
      }

      await apiFetch(`/api/cards/${card.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onRefresh();
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCard = async () => {
    if (!confirm('Delete this card? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/cards/${card.id}`, { method: 'DELETE' });
      onRefresh();
      onClose();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const fetchLog = async () => {
    setIsLogVisible(true);
    setLogContent('Loading...');
    try {
      const text = await apiFetch(`/api/cards/${card.id}/log`);
      setLogContent(text || '(no log output)');
    } catch (err) {
      setLogContent('Failed to load log: ' + err.message);
    }
  };

  const postComment = async () => {
    if (!commentText.trim()) return;
    try {
      const data = await apiFetch(`/api/cards/${card.id}/activity`, {
        method: 'POST',
        body: JSON.stringify({ text: commentText.trim() }),
      });
      setActivity(Array.isArray(data) ? data : []);
      setCommentText('');
      markRead();
    } catch (err) {
      alert('Failed to post comment: ' + err.message);
    }
  };

  const submitReply = async () => {
    if (!replyText.trim()) return;
    setIsReplying(true);
    try {
      await apiFetch(`/api/cards/${card.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: replyText.trim() }),
      });
      setReplyText('');
      onRefresh();
    } catch (err) {
      alert('Failed to send reply: ' + err.message);
    } finally {
      setIsReplying(false);
    }
  };

  const moveCard = async (colId) => {
    try {
      await apiFetch(`/api/cards/${card.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ column: colId }),
      });
      onRefresh();
    } catch (err) {
      alert('Failed to move: ' + err.message);
    }
  };

  const changeProject = async (projectId) => {
    try {
      await apiFetch(`/api/cards/${card.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ projectId: projectId === 'null' ? null : projectId }),
      });
      setIsProjectDropdownOpen(false);
      onRefresh();
    } catch (err) {
      alert('Failed to change project: ' + err.message);
    }
  };

  const status = card.status || 'idle';
  const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const label = STATUS_LABELS[status] || status;
  const runningClass = status === 'running' ? ' running' : '';
  const isAwaitingHuman = status === 'awaiting_human';
  const currentProject = projects.find(p => p.id === card.projectId) || { id: 'null', name: 'Global (No Project)' };

  return html`
    <div class="modal-overlay active" onClick=${onClose}>
      <div class="modal-panel" onClick=${e => e.stopPropagation()}>
        <div class="flex items-start justify-between mb-6">
          <div class="flex-1">
            <input 
              class="bg-transparent border-none text-xl font-bold text-white w-full focus:outline-none focus:ring-0 p-0" 
              value=${title}
              onInput=${e => setTitle(e.target.value)}
            />
            <div class="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">
              ${currentProject.name}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-ghost p-2" onClick=${deleteCard} title="Delete card">
              <svg class="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
            <button class="btn btn-ghost p-2" onClick=${onClose}>
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div class="field-group">
              <label class="label">Status & Stage</label>
              <div class="flex items-center gap-2 mb-3">
                <span class="status-dot${runningClass}" style="background:${color};"></span>
                <span class="text-gray-300">${label}</span>
              </div>
              <select class="input-field" value=${card.column || 'backlog'} onChange=${e => moveCard(e.target.value)}>
                ${columns.map(c => html`<option value=${c.id}>${c.name}</option>`)}
              </select>
            </div>

            <div class="field-group">
              <label class="label">Project</label>
              <div class="custom-select ${isProjectDropdownOpen ? 'open' : ''}">
                <div class="custom-select-trigger" onClick=${() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}>
                  <span>${currentProject.name}</span>
                  <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="custom-select-options ${isProjectDropdownOpen ? 'active' : ''}">
                  <div class="custom-select-option" onClick=${() => changeProject('null')}>Global (No Project)</div>
                  ${projects.map(p => html`
                    <div class="custom-select-option" onClick=${() => changeProject(p.id)}>${p.name}</div>
                  `)}
                </div>
              </div>
            </div>

            <div class="field-group">
              <label class="label">Description</label>
              <textarea 
                class="input-field" 
                placeholder="Add a description..." 
                style="min-height:120px;"
                value=${description}
                onInput=${e => setDescription(e.target.value)}
              ></textarea>
            </div>

            <div class="field-group">
              <label class="label">Tags</label>
              <input 
                class="input-field" 
                placeholder="comma-separated tags" 
                value=${tags}
                onInput=${e => setTags(e.target.value)}
              />
            </div>

            <div class="field-group">
              <label class="label">Attention</label>
              <select 
                class="input-field mb-2" 
                value=${attentionMode} 
                onChange=${e => setAttentionMode(e.target.value)}
                disabled=${isAwaitingHuman}
              >
                <option value="none">Normal (No special attention)</option>
                <option value="waiting_on_patrick">Needs Patrick</option>
              </select>
              ${attentionMode === 'waiting_on_patrick' && html`
                <input 
                  class="input-field" 
                  placeholder="Reason for attention..." 
                  value=${attentionReason}
                  onInput=${e => setAttentionReason(e.target.value)}
                  disabled=${isAwaitingHuman}
                />
              `}
              <p class="text-[10px] text-slate-500 mt-2">
                ${isAwaitingHuman 
                  ? 'This card is waiting on an active agent question. Reply below to resume.' 
                  : 'Opening the modal marks unread content as read. Needs Patrick stays active until cleared.'}
              </p>
            </div>
          </div>

          <div>
            ${isAwaitingHuman && card.attentionReason && html`
              <div class="field-group">
                <label class="label text-orange-400">Agent Question</label>
                <div class="question-block">${card.attentionReason}</div>
                <textarea 
                  class="input-field mt-3" 
                  placeholder="Type your reply..." 
                  style="min-height:80px; border-color: rgba(249, 115, 22, 0.4);"
                  value=${replyText}
                  onInput=${e => setReplyText(e.target.value)}
                  disabled=${isReplying}
                ></textarea>
                <button 
                  class="btn btn-primary w-full mt-3 bg-orange-600 hover:bg-orange-700" 
                  onClick=${submitReply}
                  disabled=${isReplying || !replyText.trim()}
                >
                  ${isReplying ? 'Sending...' : 'Reply & Resume'}
                </button>
              </div>
            `}

            <div class="field-group">
              <label class="label">Timeline</label>
              <div class="activity-trail mb-3">
                <${ActivityTrail} activity=${activity} columns=${columns} />
              </div>
              ${!isAwaitingHuman && html`
                <div class="flex gap-2">
                  <input 
                    class="input-field flex-1" 
                    placeholder="Add a comment..." 
                    value=${commentText}
                    onInput=${e => setCommentText(e.target.value)}
                    onKeyDown=${e => e.key === 'Enter' && !e.shiftKey && postComment()}
                  />
                  <button class="btn btn-secondary" onClick=${postComment} disabled=${!commentText.trim()}>Post</button>
                </div>
              `}
            </div>

            <div class="flex gap-3">
              <button class="btn btn-primary flex-1" onClick=${saveEdits} disabled=${isSaving}>
                ${isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button class="btn btn-secondary flex-1" onClick=${fetchLog}>View Logs</button>
            </div>
          </div>
        </div>

        ${isLogVisible && html`
          <div class="mt-8">
            <label class="label mb-2">Full Execution Log</label>
            <pre class="bg-slate-950 p-4 rounded-lg text-xs font-mono text-emerald-400 overflow-auto max-h-[400px] border border-slate-800">${logContent}</pre>
          </div>
        `}
      </div>
    </div>
  `;
}

function ActivityTrail({ activity, columns }) {
  if (!activity || activity.length === 0) {
    return html`<div class="activity-empty p-8 text-center text-slate-500 text-sm">No timeline yet.</div>`;
  }

  const sorted = [...activity].reverse();
  let lastDayLabel = null;
  const elements = [];

  sorted.forEach(entry => {
    const dayLabel = formatActivityDayLabel(entry.timestamp);
    if (dayLabel && dayLabel !== lastDayLabel) {
      elements.push(html`<div class="activity-separator text-center text-[10px] uppercase tracking-widest text-slate-600 py-4 border-b border-slate-800/50 mb-4">${dayLabel}</div>`);
      lastDayLabel = dayLabel;
    }
    const meta = ACTIVITY_META[entry.type] || ACTIVITY_META.unknown_event;
    
    elements.push(html`
      <div class="activity-entry px-4 pb-4">
        <div class="activity-icon bg-slate-800 text-[10px] w-6 h-6 rounded-full flex items-center justify-center mr-3 mt-1 flex-shrink-0">${meta.icon}</div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-baseline mb-1">
            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${meta.label}</span>
            <span class="text-[10px] text-slate-600">${formatActivityTime(entry.timestamp)}</span>
          </div>
          <div class="text-sm text-slate-200 leading-relaxed break-words">
            <${ActivityBody} entry=${entry} columns=${columns} />
          </div>
        </div>
      </div>
    `);
  });

  return elements;
}

function ActivityBody({ entry, columns }) {
  const getColumnName = (id) => columns.find(c => c.id === id)?.name || id;

  switch (entry.type) {
    case 'stage_changed':
      return html`
        <div class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 bg-slate-800 rounded text-[11px]">${getColumnName(entry.fromColumn)}</span>
          <span class="text-slate-600">→</span>
          <span class="px-1.5 py-0.5 bg-blue-900/40 text-blue-200 rounded text-[11px]">${getColumnName(entry.toColumn)}</span>
        </div>
      `;
    case 'status_changed':
      return html`
        <div class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 bg-slate-800 rounded text-[11px]">${statusLabel(entry.fromStatus)}</span>
          <span class="text-slate-600">→</span>
          <span class="px-1.5 py-0.5 bg-slate-800 rounded text-[11px]">${statusLabel(entry.toStatus)}</span>
        </div>
      `;
    case 'run_started':
      const verb = /resum/i.test(entry.text || '') ? 'Resumed' : 'Started';
      return html`<span class="text-slate-400 italic">${verb} ${getColumnName(entry.column || entry.toColumn)}</span>`;
    case 'run_completed':
      return html`<span class="text-emerald-400 font-medium">${getColumnName(entry.column || entry.toColumn)} completed</span>`;
    case 'run_failed':
      return html`<span class="text-red-400 font-medium">${getColumnName(entry.column || entry.toColumn)} failed ${entry.exitCode ? `(exit ${entry.exitCode})` : ''}</span>`;
    case 'agent_comment':
    case 'human_comment':
    case 'agent_question':
    case 'human_reply':
      return html`<div class="whitespace-pre-wrap">${entry.text}</div>`;
    default:
      return html`<span>${entry.text || 'System event'}</span>`;
  }
}

function AddCardModal({ isOpen, projects, preselectedProjectId, onClose, onRefresh }) {
  if (!isOpen) return null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [projectId, setProjectId] = useState(preselectedProjectId || '');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentProject = projects.find(p => p.id === projectId) || { id: '', name: 'Global (No Project)' };

  const submit = async () => {
    if (!title.trim()) return;
    setIsSubmitting(true);
    try {
      await apiFetch('/api/cards', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          projectId: projectId || null
        }),
      });
      onRefresh();
      onClose();
      setTitle('');
      setDescription('');
      setTags('');
      setProjectId('');
    } catch (err) {
      alert('Failed to create card: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return html`
    <div class="modal-overlay active" onClick=${onClose}>
      <div class="modal-panel" style="max-width:480px;" onClick=${e => e.stopPropagation()}>
        <div class="flex items-center justify-between mb-6">
          <h2 class="modal-title mb-0">New Card</h2>
          <button class="btn btn-ghost" onClick=${onClose}>
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div class="field-group">
          <label class="label">Project</label>
          <div class="custom-select ${isProjectDropdownOpen ? 'open' : ''}">
            <div class="custom-select-trigger" onClick=${() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}>
              <span>${currentProject.name}</span>
              <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="custom-select-options ${isProjectDropdownOpen ? 'active' : ''}">
              <div class="custom-select-option" onClick=${() => { setProjectId(''); setIsProjectDropdownOpen(false); }}>Global (No Project)</div>
              ${projects.map(p => html`
                <div class="custom-select-option" onClick=${() => { setProjectId(p.id); setIsProjectDropdownOpen(false); }}>${p.name}</div>
              `)}
            </div>
          </div>
        </div>

        <div class="field-group">
          <label class="label">Title *</label>
          <input 
            class="input-field" 
            placeholder="Summary of the task..." 
            value=${title}
            onInput=${e => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div class="field-group">
          <label class="label">Description</label>
          <textarea 
            class="input-field" 
            placeholder="Context for the agent..." 
            style="min-height:100px;"
            value=${description}
            onInput=${e => setDescription(e.target.value)}
          ></textarea>
        </div>

        <div class="field-group">
          <label class="label">Tags</label>
          <input 
            class="input-field" 
            placeholder="bug, ui, backend (comma separated)" 
            value=${tags}
            onInput=${e => setTags(e.target.value)}
          />
        </div>

        <div class="flex gap-3">
          <button class="btn btn-primary flex-1" onClick=${submit} disabled=${isSubmitting || !title.trim()}>
            ${isSubmitting ? 'Creating...' : 'Create Card'}
          </button>
          <button class="btn btn-secondary flex-1" onClick=${onClose}>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function ProjectManagerModal({ isOpen, projects, onClose, onRefresh }) {
  if (!isOpen) return null;

  const [newName, setNewName] = useState('');
  const [newDir, setNewDir] = useState('');
  const [newAiCli, setNewAiCli] = useState('claude');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitAdd = async () => {
    if (!newName.trim() || !newDir.trim()) return;
    setIsSubmitting(true);
    try {
      await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), directory: newDir.trim(), aiCli: newAiCli })
      });
      setNewName('');
      setNewDir('');
      setNewAiCli('claude');
      onRefresh();
    } catch (err) {
      alert('Failed to create project: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteProject = async (id) => {
    if (!confirm('Delete this project? All associated cards will be permanently deleted.')) return;
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert('Failed to delete project: ' + err.message);
    }
  };

  const updateProjectAi = async (id, aiCli) => {
    try {
      await apiFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ aiCli })
      });
      onRefresh();
    } catch (err) {
      alert('Failed to update project: ' + err.message);
    }
  };

  return html`
    <div class="modal-overlay active" onClick=${onClose}>
      <div class="modal-panel" onClick=${e => e.stopPropagation()}>
        <div class="flex items-center justify-between mb-6">
          <h2 class="modal-title mb-0">Manage Projects</h2>
          <button class="btn btn-ghost" onClick=${onClose}>
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div class="space-y-4 mb-8">
          ${projects.length === 0 ? html`
            <div class="text-sm text-slate-500 text-center py-4">No projects yet.</div>
          ` : projects.map(p => html`
            <div class="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div>
                <div class="font-medium text-sm text-white">${p.name}</div>
                <div class="text-xs text-slate-400 font-mono mt-0.5">${p.directory}</div>
              </div>
              <div class="flex items-center gap-2">
                <select 
                  class="input-field" 
                  style="width: auto; padding: 2px 8px; min-height: unset; height: 28px; font-size: 0.75rem;"
                  value=${p.aiCli || 'claude'}
                  onChange=${e => updateProjectAi(p.id, e.target.value)}
                >
                  <option value="claude">Claude CLI</option>
                  <option value="gemini">Gemini CLI</option>
                </select>
                <button class="btn btn-ghost text-red-400 hover:text-red-300 hover:bg-red-900/30 px-2 py-1 h-auto min-h-0 text-xs" onClick=${() => deleteProject(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          `)}
        </div>

        <div class="border-t border-slate-700 pt-6">
          <h3 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Add New Project</h3>
          <div class="grid grid-cols-1 gap-4">
            <div class="field-group mb-0">
              <label class="label">Project Name</label>
              <input class="input-field" placeholder="e.g. Botlanes" value=${newName} onInput=${e => setNewName(e.target.value)} />
            </div>
            <div class="field-group mb-0">
              <label class="label">Project Directory (Relative to root)</label>
              <input class="input-field" placeholder="e.g. ." value=${newDir} onInput=${e => setNewDir(e.target.value)} />
            </div>
            <div class="field-group mb-0">
              <label class="label">AI Provider</label>
              <select class="input-field" value=${newAiCli} onChange=${e => setNewAiCli(e.target.value)}>
                <option value="claude">Claude CLI</option>
                <option value="gemini">Gemini CLI</option>
              </select>
            </div>
            <button class="btn btn-primary w-full" onClick=${submitAdd} disabled=${isSubmitting || !newName.trim() || !newDir.trim()}>
              ${isSubmitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const data = await apiFetch('/api/info');
        setInfo(data);
      } catch {}
    };
    fetchInfo();
  }, []);

  const submit = async () => {
    setError('');
    try {
      const res = await fetch(BASE_PATH + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => 'Invalid password');
        setError(text || 'Invalid password');
        return;
      }
      onLogin();
    } catch (err) {
      setError('Network error: ' + err.message);
    }
  };

  const formatUptime = (seconds) => {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
    return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
  };

  return html`
    <div class="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div class="bg-slate-900 border border-slate-800 p-8 rounded-2xl w-full max-w-md shadow-2xl">
        <div class="flex items-center gap-3 mb-8">
          <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
            <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </div>
          <div>
            <h1 class="text-lg font-bold text-white">Mission Control</h1>
            <p class="text-xs text-slate-500">Sign in to continue</p>
          </div>
        </div>
        <div class="field-group">
          <label class="label">Password</label>
          <input 
            class="input-field" 
            type="password" 
            placeholder="Enter password..." 
            value=${password}
            onInput=${e => setPassword(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && submit()}
            autoFocus
          />
        </div>
        ${error && html`<div class="text-red-400 text-sm mb-4 bg-red-900/20 border border-red-900/50 p-3 rounded-lg">${error}</div>`}
        <button class="btn btn-primary w-full py-3 text-base shadow-lg shadow-blue-900/20" onClick=${submit}>Sign In</button>
        
        ${info && html`
          <div class="mt-8 pt-6 border-t border-slate-800 text-[10px] text-slate-500 space-y-1.5 font-mono">
            <div>v${info.version} • ${info.runtime}</div>
            <div>Up ${formatUptime(info.uptime)} • ${info.cards} card${info.cards !== 1 ? 's' : ''}</div>
            <div>${info.executionMode === 'claude-cli' ? 'Claude CLI mode' : 'Standard mode'}</div>
          </div>
        `}
      </div>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
