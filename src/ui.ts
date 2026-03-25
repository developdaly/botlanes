export const MISSION_CONTROL_COLUMNS = [
  { id: 'backlog', name: 'Backlog', skill: null, summary: 'New tasks waiting to be picked up.', detail: 'Raw incoming work lives here until someone moves it into the active workflow.', outcome: null, isCoreFlow: false },
  { id: 'office-hours', name: 'Office Hours', skill: '/office-hours', summary: 'Start here. Reframe the problem before anyone writes code.', detail: 'Six forcing questions challenge the framing, surface better alternatives, and generate the design doc downstream stages build on.', outcome: 'Design Doc', isCoreFlow: true },
  { id: 'ceo-review', name: 'CEO Review', skill: '/plan-ceo-review', summary: 'Pressure-test the idea and make sure the scope is worth shipping.', detail: 'Strategy review: challenge the plan, sharpen the product call, and decide whether to expand, hold, or cut scope.', outcome: 'Scope Decision', isCoreFlow: false },
  { id: 'eng-review', name: 'Eng Review', skill: '/plan-eng-review', summary: 'Lock architecture, edge cases, tests, and performance expectations.', detail: 'Engineering review validates the execution plan so implementation starts with the right shape, not guesses.', outcome: 'Engineering Plan', isCoreFlow: true },
  { id: 'design-review', name: 'Design Review', skill: '/plan-design-review', summary: 'Critique the UX direction and tighten the interaction model.', detail: 'Design review closes the gaps in hierarchy, states, responsiveness, and trust before pixels get coded.', outcome: 'Design Critique', isCoreFlow: false },
  { id: 'design', name: 'Design', skill: '/design-consultation', summary: 'Define the design system: typography, color, layout, spacing, motion.', detail: 'This stage produces the shared visual language so the implementation feels intentional instead of improvised.', outcome: 'DESIGN.md', isCoreFlow: false },
  { id: 'implementation', name: 'Implementation', skill: null, summary: 'Write the code for the chosen plan.', detail: 'This is where the approved plan turns into working product changes in the codebase.', outcome: 'Code', isCoreFlow: true },
  { id: 'code-review', name: 'Code Review', skill: '/review', summary: 'Catch structural issues before landing.', detail: 'Pre-landing review looks for correctness, safety, and quality issues while the change is still cheap to fix.', outcome: 'Review Verdict', isCoreFlow: true },
  { id: 'debug', name: 'Debug', skill: '/debug', summary: 'Investigate what broke and why.', detail: 'Use this when behavior is wrong, unclear, or flaky and the team needs a root-cause pass instead of more guessing.', outcome: 'Fix + Root Cause', isCoreFlow: false },
  { id: 'qa', name: 'QA', skill: '/qa', summary: 'Test the feature like a user and verify fixes.', detail: 'QA checks the real user flow, finds regressions, and confirms the implementation actually works outside the happy path.', outcome: 'QA Report', isCoreFlow: true },
  { id: 'ship', name: 'Ship', skill: '/ship', summary: 'Merge, version, changelog, push, and open the PR.', detail: 'This is the release step: package the work cleanly so it is ready to land and move forward with confidence.', outcome: 'Merged PR', isCoreFlow: true },
  { id: 'docs', name: 'Docs', skill: '/document-release', summary: 'Update project docs to match what shipped.', detail: 'Sync README, architecture notes, and release documentation so future readers see the truth, not stale intent.', outcome: 'Updated Docs', isCoreFlow: false },
  { id: 'retro', name: 'Retro', skill: '/retro', summary: 'Capture lessons from the work and the process.', detail: 'Use retrospective time to distill what worked, what hurt, and what should change next time.', outcome: 'Retro Report', isCoreFlow: false },
  { id: 'done', name: 'Done', skill: null, summary: 'Finished work that is ready to archive visually.', detail: 'Completed cards live here so the active pipeline stays focused on work still in motion.', outcome: null, isCoreFlow: false },
] as const;

export function generateBoardHTML(basePath: string = ''): string {
  // Strip trailing slash from basePath
  const bp = basePath.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }

    body {
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    #board {
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      flex: 1;
      gap: 12px;
      padding: 12px;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
    }

    #board::-webkit-scrollbar {
      height: 8px;
    }
    #board::-webkit-scrollbar-track {
      background: #111827;
      border-radius: 4px;
    }
    #board::-webkit-scrollbar-thumb {
      background: #374151;
      border-radius: 4px;
    }
    #board::-webkit-scrollbar-thumb:hover {
      background: #4B5563;
    }

    .column {
      flex: 0 0 280px;
      width: 280px;
      min-width: 280px;
      background: #374151;
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      max-height: 100%;
      scroll-snap-align: start;
      transition: background 0.15s ease;
    }

    .column.drag-over {
      background: #4B5563;
      outline: 2px dashed #6B7280;
    }

    .column-header {
      padding: 12px 12px 8px;
      flex-shrink: 0;
      border-bottom: 1px solid #4B5563;
      border-top: 2px solid transparent;
    }

    .column-header--core {
      border-top-color: rgba(96, 165, 250, 0.95);
      box-shadow: inset 0 1px 0 rgba(191, 219, 254, 0.08);
    }

    .column-summary {
      margin-top: 8px;
      color: #D1D5DB;
      font-size: 12px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }

    .column-outcome {
      margin-top: 8px;
      color: #9CA3AF;
      font-size: 11px;
      line-height: 1.35;
    }

    .column-outcome-label {
      color: #6B7280;
      margin-right: 4px;
    }

    .column-utility-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      min-height: 20px;
    }

    .column-core-pill {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 8px;
      border-radius: 9999px;
      background: rgba(59, 130, 246, 0.14);
      border: 1px solid rgba(96, 165, 250, 0.28);
      color: #BFDBFE;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      flex-shrink: 0;
    }

    .column-skill {
      color: #6B7280;
      font-size: 11px;
      line-height: 1.3;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: right;
      flex: 1;
      min-width: 0;
    }

    .column-details {
      margin-top: 8px;
    }

    .column-details-toggle {
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 44px;
      padding: 8px 0 4px;
      cursor: pointer;
      color: #9CA3AF;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
      user-select: none;
    }

    .column-details-toggle::-webkit-details-marker {
      display: none;
    }

    .column-details-toggle:focus-visible {
      outline: 2px solid rgba(96, 165, 250, 0.9);
      outline-offset: 3px;
      border-radius: 6px;
    }

    .column-details-toggle-copy {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .column-details-label-less {
      display: none;
    }

    .column-details[open] .column-details-label-more {
      display: none;
    }

    .column-details[open] .column-details-label-less {
      display: inline;
    }

    .column-details-chevron {
      color: #6B7280;
      transition: transform 0.15s ease;
      flex-shrink: 0;
    }

    .column-details[open] .column-details-chevron {
      transform: rotate(180deg);
    }

    .column-detail-body {
      padding: 2px 0 4px;
      color: #D1D5DB;
      font-size: 12px;
      line-height: 1.5;
      word-break: break-word;
    }

    .column-detail-skill {
      margin-top: 8px;
      color: #6B7280;
      font-size: 11px;
      line-height: 1.35;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      word-break: break-all;
    }

    @media (max-width: 640px) {
      .column-summary {
        -webkit-line-clamp: 3;
      }

      .column-skill {
        display: none;
      }
    }

    .column-cards {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .column-cards::-webkit-scrollbar {
      width: 4px;
    }
    .column-cards::-webkit-scrollbar-track {
      background: transparent;
    }
    .column-cards::-webkit-scrollbar-thumb {
      background: #4B5563;
      border-radius: 2px;
    }

    .card {
      background: #1F2937;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      border: 1px solid #374151;
      transition: all 0.15s ease;
      user-select: none;
    }

    .card:hover {
      border-color: #4B5563;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      transform: translateY(-1px);
    }

    .card.dragging {
      opacity: 0.4;
      transform: rotate(2deg);
    }

    .card.drag-over-card {
      border-color: #3B82F6;
    }

    .card.awaiting-human {
      border-color: rgba(249, 115, 22, 0.45);
      box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.18);
    }

    .awaiting-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(249, 115, 22, 0.14);
      border: 1px solid rgba(249, 115, 22, 0.35);
      color: #FDBA74;
      border-radius: 9999px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 8px;
    }

    .question-preview {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(249, 115, 22, 0.08);
      border: 1px solid rgba(249, 115, 22, 0.18);
      color: #FED7AA;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 5px;
      flex-shrink: 0;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      align-items: center;
      justify-content: center;
      z-index: 50;
      backdrop-filter: blur(2px);
    }

    .modal-overlay:not(.hidden) {
      display: flex;
    }

    .modal-panel {
      background: #1F2937;
      border-radius: 12px;
      padding: 24px;
      width: 90%;
      max-width: 560px;
      max-height: 85vh;
      overflow-y: auto;
      border: 1px solid #374151;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }

    .modal-panel::-webkit-scrollbar {
      width: 4px;
    }
    .modal-panel::-webkit-scrollbar-thumb {
      background: #4B5563;
      border-radius: 2px;
    }

    .log-viewer {
      background: #111827;
      border-radius: 6px;
      padding: 12px;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.6;
      max-height: 300px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #D1FAE5;
      border: 1px solid #374151;
    }

    .log-viewer::-webkit-scrollbar {
      width: 4px;
    }
    .log-viewer::-webkit-scrollbar-thumb {
      background: #374151;
      border-radius: 2px;
    }

    .tag-badge {
      display: inline-flex;
      align-items: center;
      background: #374151;
      color: #9CA3AF;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 500;
      margin-right: 4px;
      margin-bottom: 4px;
    }

    .model-badge {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      background: rgba(79, 70, 229, 0.14);
      color: #C7D2FE;
      border: 1px solid rgba(129, 140, 248, 0.38);
      border-radius: 9999px;
      padding: 3px 9px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .model-badge.unavailable {
      background: rgba(245, 158, 11, 0.14);
      color: #FCD34D;
      border-color: rgba(251, 191, 36, 0.38);
    }

    .card--needs-patrick {
      border-color: rgba(249, 115, 22, 0.38);
    }

    .card--needs-patrick:hover {
      border-color: rgba(249, 115, 22, 0.55);
    }

    .attention-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border-radius: 9999px;
    }

    .attention-chip--comments {
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      background: rgba(139, 92, 246, 0.16);
      border: 1px solid rgba(139, 92, 246, 0.32);
      color: #C4B5FD;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }

    .attention-chip--output {
      width: 10px;
      height: 10px;
      background: #60A5FA;
      box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.45);
      animation: attention-pulse 1.8s ease-out infinite;
    }

    .attention-pill-row {
      margin-top: 8px;
    }

    .attention-pill {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      border: 1px solid rgba(249, 115, 22, 0.35);
      background: rgba(249, 115, 22, 0.14);
      color: #FDBA74;
    }

    @keyframes attention-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.45);
      }
      70% {
        box-shadow: 0 0 0 6px rgba(96, 165, 250, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(96, 165, 250, 0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .attention-chip--output {
        animation: none;
      }
    }

    .field-help {
      margin-top: 8px;
      font-size: 12px;
      line-height: 1.5;
      color: #9CA3AF;
    }

    .field-help.hidden,
    .field-warning.hidden,
    .field-error.hidden,
    .field-mono.hidden {
      display: none;
    }

    .field-warning {
      margin-top: 8px;
      border-radius: 8px;
      border: 1px solid rgba(251, 191, 36, 0.34);
      background: rgba(245, 158, 11, 0.1);
      color: #FDE68A;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
    }

    .field-error {
      margin-top: 8px;
      font-size: 12px;
      color: #FCA5A5;
    }

    .field-mono {
      margin-top: 6px;
      font-size: 11px;
      line-height: 1.5;
      color: #6B7280;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      word-break: break-all;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      border: none;
      outline: none;
    }

    .btn-primary {
      background: #3B82F6;
      color: white;
    }
    .btn-primary:hover {
      background: #2563EB;
    }

    .btn-secondary {
      background: #374151;
      color: #D1D5DB;
    }
    .btn-secondary:hover {
      background: #4B5563;
    }

    .btn-danger {
      background: #7F1D1D;
      color: #FCA5A5;
    }
    .btn-danger:hover {
      background: #991B1B;
    }

    .btn-ghost {
      background: transparent;
      color: #9CA3AF;
      padding: 4px 8px;
    }
    .btn-ghost:hover {
      background: #374151;
      color: #D1D5DB;
    }

    .input-field {
      background: #111827;
      border: 1px solid #374151;
      border-radius: 6px;
      padding: 8px 12px;
      color: #F9FAFB;
      font-size: 14px;
      width: 100%;
      outline: none;
      transition: border-color 0.15s;
    }
    .input-field:focus {
      border-color: #3B82F6;
    }
    .input-field::placeholder {
      color: #6B7280;
    }

    textarea.input-field {
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }

    select.input-field {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 16px;
      padding-right: 32px;
    }

    .label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #9CA3AF;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .field-group {
      margin-bottom: 16px;
    }

    .attachment-empty {
      border: 1px dashed #374151;
      border-radius: 10px;
      background: rgba(17, 24, 39, 0.45);
      color: #D1D5DB;
      padding: 12px 14px;
      margin-bottom: 10px;
      font-size: 13px;
      line-height: 1.5;
    }

    .attachment-empty.hidden {
      display: none;
    }

    .attachment-empty-title {
      color: #F3F4F6;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .attachment-empty-meta {
      color: #9CA3AF;
      font-size: 12px;
      margin-top: 6px;
    }

    .attachment-strip {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }

    .attachment-strip:empty {
      display: none;
    }

    .attachment-strip::-webkit-scrollbar {
      height: 6px;
    }

    .attachment-strip::-webkit-scrollbar-thumb {
      background: #374151;
      border-radius: 999px;
    }

    .attachment-card {
      flex: 0 0 auto;
      width: 92px;
      position: relative;
    }

    .attachment-thumb {
      width: 72px;
      height: 72px;
      border-radius: 10px;
      overflow: hidden;
      background: #111827;
      border: 1px solid #374151;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .attachment-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .attachment-fallback {
      display: none;
      width: 100%;
      height: 100%;
      padding: 8px;
      font-size: 11px;
      line-height: 1.4;
      color: #FBBF24;
      text-align: center;
      align-items: center;
      justify-content: center;
      background: rgba(245, 158, 11, 0.08);
    }

    .attachment-status {
      margin-top: 6px;
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid transparent;
    }

    .attachment-status--queued {
      background: rgba(59, 130, 246, 0.12);
      color: #BFDBFE;
      border-color: rgba(96, 165, 250, 0.28);
    }

    .attachment-status--used {
      background: rgba(16, 185, 129, 0.12);
      color: #A7F3D0;
      border-color: rgba(52, 211, 153, 0.28);
    }

    .attachment-name {
      margin-top: 4px;
      font-size: 11px;
      line-height: 1.4;
      color: #9CA3AF;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 84px;
    }

    .attachment-remove {
      position: absolute;
      top: -6px;
      right: 6px;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.95);
      border: 1px solid #4B5563;
      color: #F3F4F6;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .attachment-dropzone {
      border: 1px dashed #4B5563;
      border-radius: 10px;
      background: rgba(17, 24, 39, 0.55);
      color: #D1D5DB;
      padding: 12px 14px;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    .attachment-dropzone:hover,
    .attachment-dropzone.drag-active {
      border-color: #60A5FA;
      background: rgba(30, 41, 59, 0.92);
    }

    .attachment-dropzone.is-disabled {
      opacity: 0.65;
      cursor: progress;
    }

    .attachment-dropzone-title {
      color: #F9FAFB;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .attachment-dropzone-meta {
      color: #9CA3AF;
      font-size: 12px;
    }

    .card-attachment-indicator {
      margin-top: 8px;
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(59, 130, 246, 0.12);
      color: #BFDBFE;
      border: 1px solid rgba(96, 165, 250, 0.24);
    }

    .attachment-preview-panel {
      position: relative;
      max-width: min(90vw, 960px);
      max-height: 88vh;
      padding: 16px;
      border-radius: 14px;
      background: #111827;
      border: 1px solid #374151;
      box-shadow: 0 20px 60px rgba(0,0,0,0.55);
    }

    .attachment-preview-image {
      max-width: 100%;
      max-height: calc(88vh - 32px);
      display: block;
      border-radius: 10px;
      margin: 0 auto;
    }

    .attachment-preview-close {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 2;
    }

    #login-page {
      position: fixed;
      inset: 0;
      background: #111827;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    #login-page:not(.hidden) {
      display: flex;
    }

    .login-card {
      background: #1F2937;
      border-radius: 16px;
      padding: 40px;
      width: 90%;
      max-width: 380px;
      border: 1px solid #374151;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .inline-editable {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 2px 4px;
      color: inherit;
      font: inherit;
      width: 100%;
      outline: none;
      transition: border-color 0.15s;
    }
    .inline-editable:hover {
      border-color: #374151;
    }
    .inline-editable:focus {
      border-color: #3B82F6;
      background: #111827;
    }

    .column-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #4B5563;
      color: #9CA3AF;
      border-radius: 10px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      font-size: 11px;
      font-weight: 600;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .status-dot.running {
      animation: pulse-dot 1.5s ease-in-out infinite;
    }

    .empty-column-hint {
      color: #4B5563;
      font-size: 12px;
      text-align: center;
      padding: 20px 8px;
      border: 1px dashed #374151;
      border-radius: 6px;
      margin: 4px;
    }

    .activity-trail {
      max-height: 320px;
      overflow-y: auto;
      border: 1px solid #374151;
      border-radius: 10px;
      background: #111827;
    }

    .activity-trail::-webkit-scrollbar { width: 4px; }
    .activity-trail::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }

    .activity-separator {
      padding: 8px 12px;
      border-top: 1px solid #1F2937;
      border-bottom: 1px solid #1F2937;
      background: rgba(255,255,255,0.02);
      color: #6B7280;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .activity-entry {
      padding: 10px 12px;
      border-bottom: 1px solid #1F2937;
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .activity-entry:last-child { border-bottom: none; }
    .activity-entry--agent { background: rgba(59, 130, 246, 0.06); }
    .activity-entry--human { background: rgba(148, 163, 184, 0.07); }

    .activity-icon {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      margin-top: 2px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(148, 163, 184, 0.10);
      color: #D1D5DB;
    }
    .activity-icon--system { background: rgba(52, 211, 153, 0.10); color: #34D399; }
    .activity-icon--stage { background: rgba(59, 130, 246, 0.12); color: #60A5FA; }
    .activity-icon--status { background: rgba(99, 102, 241, 0.12); color: #A5B4FC; }
    .activity-icon--agent { background: rgba(96, 165, 250, 0.12); color: #93C5FD; }
    .activity-icon--human { background: rgba(148, 163, 184, 0.14); color: #E5E7EB; }

    .activity-main { flex: 1; min-width: 0; }
    .activity-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    }
    .activity-label {
      color: #9CA3AF;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .activity-time {
      color: #6B7280;
      font-size: 11px;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .activity-body {
      color: #D1D5DB;
      font-size: 13px;
      line-height: 1.55;
      white-space: normal;
      word-break: break-word;
    }
    .activity-body--system { color: #9CA3AF; }
    .activity-body--comment {
      color: #E5E7EB;
      white-space: pre-wrap;
    }
    .activity-delta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }
    .activity-chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      color: #E5E7EB;
      font-size: 12px;
      line-height: 1;
      padding: 6px 8px;
    }
    .activity-arrow {
      color: #6B7280;
      font-size: 12px;
    }

    .question-block {
      border-radius: 10px;
      border: 1px solid rgba(249, 115, 22, 0.32);
      background: rgba(249, 115, 22, 0.08);
      padding: 12px;
      color: #FED7AA;
      white-space: pre-wrap;
      line-height: 1.6;
    }

    .activity-empty {
      color: #6B7280;
      text-align: center;
      padding: 18px 16px;
      font-size: 13px;
      line-height: 1.6;
    }
  </style>
</head>
<body class="bg-gray-900 text-gray-100">

  <!-- Header -->
  <header class="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0" style="min-height:56px;">
    <div class="flex items-center gap-3">
      <div class="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
        <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
        </svg>
      </div>
      <div>
        <h1 class="text-sm font-bold text-white leading-tight">Mission Control</h1>
        <p class="text-xs text-gray-500 leading-tight">Kanban Board</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <span id="header-info" class="text-xs text-gray-500 hidden"></span>
      <span id="poll-indicator" class="w-2 h-2 rounded-full bg-gray-600" title="Polling status"></span>
      <button class="btn btn-primary text-sm" style="padding:6px 14px;" onclick="openAddModal()">
        <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Card
      </button>
    </div>
  </header>

  <!-- Board -->
  <main id="board"></main>

  <!-- Card Detail Modal -->
  <div id="card-modal" class="modal-overlay hidden">
    <div class="modal-panel" onclick="event.stopPropagation()">
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1 mr-3">
          <input id="modal-title" class="inline-editable text-lg font-semibold text-white" style="font-size:18px;font-weight:600;" />
        </div>
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" onclick="deleteCurrentCard()" title="Delete card">
            <svg class="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button class="btn btn-ghost" onclick="closeCardModal()">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div class="field-group">
        <label class="label">Status</label>
        <div id="modal-status-display" class="flex items-center gap-2 text-sm"></div>
      </div>

      <div class="field-group">
        <label class="label">Column</label>
        <select id="modal-column-select" class="input-field" onchange="moveCardFromModal(this.value)"></select>
      </div>

      <div class="field-group">
        <label class="label">Description</label>
        <textarea id="modal-description" class="input-field" placeholder="Add a description..." style="resize:vertical;min-height:80px;font-family:inherit;font-size:14px;"></textarea>
      </div>

      <div id="modal-attachments-group" class="field-group">
        <label class="label">Images for agent context</label>
        <div class="field-help" style="margin-top:0;">Included when this card runs.</div>
        <div id="modal-attachments-empty" class="attachment-empty hidden">
          <div class="attachment-empty-title">No images yet</div>
          <div>Add screenshots or mockups the agent should see in the next run.</div>
          <div class="attachment-empty-meta">PNG, JPG, GIF, WebP, SVG · up to 10 MB each · 20 max</div>
        </div>
        <div id="modal-attachments-strip" class="attachment-strip"></div>
        <div id="modal-attachments-dropzone" class="attachment-dropzone"
          onclick="openAttachmentPicker()"
          ondragover="handleAttachmentDragOver(event)"
          ondragleave="handleAttachmentDragLeave(event)"
          ondrop="handleAttachmentDrop(event)">
          <div class="attachment-dropzone-title">+ Add images</div>
          <div class="attachment-dropzone-meta">Drop or click · PNG, JPG, GIF, WebP, SVG</div>
        </div>
        <input id="modal-attachments-input" type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml,.svg" multiple class="hidden" onchange="handleAttachmentInputChange(event)" />
        <div id="modal-attachments-error" class="field-error hidden"></div>
      </div>

      <div class="field-group">
        <label class="label">Tags</label>
        <input id="modal-tags" class="input-field" placeholder="comma-separated tags" />
      </div>

      <div id="modal-attention-group" class="field-group">
        <label class="label">Attention</label>
        <select id="modal-attention-mode" class="input-field" onchange="syncAttentionInputs()">
          <option value="none">Normal</option>
          <option value="waiting_on_patrick">Waiting on Patrick</option>
        </select>
        <input id="modal-attention-reason" class="input-field mt-2" placeholder="Reason (optional)" />
        <div id="modal-attention-help" class="field-help">Opening the modal marks unread output and unread comments as read. Patrick-specific attention stays active until you clear it.</div>
      </div>

      <div class="field-group">
        <label class="label">Model</label>
        <select id="modal-model-select" class="input-field" onchange="clearModelSaveError()"></select>
        <div id="modal-model-helper" class="field-help"></div>
        <div id="modal-model-session-help" class="field-help hidden"></div>
        <div id="modal-model-warning" class="field-warning hidden"></div>
        <div id="modal-model-error" class="field-error hidden"></div>
        <div id="modal-model-ref" class="field-mono hidden"></div>
      </div>

      <div id="modal-skill-section" class="field-group hidden">
        <label class="label">Skill</label>
        <div id="modal-skill-display" class="text-sm text-blue-400 font-mono bg-gray-900 rounded px-3 py-2 inline-block border border-gray-700"></div>
      </div>

      <div id="modal-question-section" class="field-group hidden">
        <label class="label" style="color:#FDBA74;">Agent Question</label>
        <div id="modal-question-text" class="question-block"></div>
        <textarea id="reply-input" class="input-field mt-3" placeholder="Reply to the agent and resume this card..." style="resize:vertical;min-height:88px;font-family:inherit;font-size:14px;border-color:rgba(249,115,22,0.38);"></textarea>
        <button id="reply-submit-button" class="btn w-full mt-2" style="background:#F97316;color:white;width:100%;justify-content:center;" onclick="submitReply()">Reply &amp; Resume Agent</button>
      </div>

      <div class="flex gap-2 mb-4">
        <button class="btn btn-primary flex-1" onclick="saveCardEdits()">Save Changes</button>
        <button class="btn btn-secondary" onclick="fetchAndShowLog()">View Log</button>
      </div>

      <!-- Activity Trail -->
      <div class="field-group">
        <label class="label">Timeline</label>
        <div id="modal-activity" class="activity-trail"></div>
        <div id="activity-comment-row" class="flex gap-2 mt-2">
          <input id="activity-comment-input" class="input-field flex-1" placeholder="Add a comment..." onkeydown="if(event.key==='Enter'&&!event.shiftKey)submitComment()" />
          <button class="btn btn-secondary" style="padding:8px 12px;" onclick="submitComment()">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
        </div>
      </div>

      <div class="field-group">
        <label class="label">Thread Details</label>
        <div id="modal-session-display" class="text-sm text-gray-300 bg-gray-900 rounded px-3 py-2 border border-gray-700 whitespace-pre-wrap"></div>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-secondary" style="padding:8px 12px;" onclick="copySessionResumeCommand()">Copy Resume Command</button>
        </div>
      </div>

      <div id="log-section" class="hidden">
        <label class="label mb-2">Execution Log</label>
        <pre id="log-content" class="log-viewer">Loading...</pre>
      </div>
    </div>
  </div>

  <div id="attachment-preview-modal" class="modal-overlay hidden" onclick="closeAttachmentPreview()">
    <div class="attachment-preview-panel" onclick="event.stopPropagation()">
      <button class="btn btn-ghost attachment-preview-close" onclick="closeAttachmentPreview()">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img id="attachment-preview-image" class="attachment-preview-image" alt="Attachment preview" />
    </div>
  </div>

  <!-- Add Card Modal -->
  <div id="add-modal" class="modal-overlay hidden">
    <div class="modal-panel" style="max-width:440px;" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-base font-semibold text-white">Add New Card</h2>
        <button class="btn btn-ghost" onclick="closeAddModal()">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="field-group">
        <label class="label">Title *</label>
        <input id="add-title" class="input-field" placeholder="What needs to get done?" />
      </div>
      <div class="field-group">
        <label class="label">Description</label>
        <textarea id="add-description" class="input-field" placeholder="Optional description..." style="font-family:inherit;font-size:14px;"></textarea>
      </div>
      <div class="field-group">
        <label class="label">Tags</label>
        <input id="add-tags" class="input-field" placeholder="feature, urgent, v2 (comma-separated)" />
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="submitAddCard()">Create Card</button>
        <button class="btn btn-secondary" onclick="closeAddModal()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Login Page -->
  <div id="login-page" class="hidden">
    <div class="login-card">
      <div class="flex items-center gap-3 mb-8">
        <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
          </svg>
        </div>
        <div>
          <h1 class="text-lg font-bold text-white">Mission Control</h1>
          <p class="text-xs text-gray-500">Sign in to continue</p>
        </div>
      </div>
      <div class="field-group">
        <label class="label">Password</label>
        <input id="login-password" class="input-field" type="password" placeholder="Enter password..." onkeydown="if(event.key==='Enter') submitLogin()" />
      </div>
      <div id="login-error" class="hidden text-red-400 text-sm mb-3"></div>
      <button class="btn btn-primary w-full" style="width:100%;justify-content:center;" onclick="submitLogin()">Sign In</button>
      <div id="login-info" class="mt-6 pt-4 border-t border-gray-700 text-xs text-gray-500 space-y-1"></div>
    </div>
  </div>

  <script>
    const BASE_PATH = '${bp}';
    const COLUMNS = ${JSON.stringify(MISSION_CONTROL_COLUMNS)};

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

    let boardState = null;
    let lastStateJSON = null;
    let currentCardId = null;
    let currentCardActivity = [];
    let dragCardId = null;
    let pollInterval = null;
    let isMobile = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 640;
    let modelCatalog = [];
    let defaultModelRef = null;
    let modelCatalogPromise = null;
    let modelCatalogError = null;
    let readMarkInFlightForCardId = null;
    let attachmentUploadInFlight = false;

    function attachmentState(card, attachment) {
      if (attachment && attachment.lastUsedAt) return 'used';
      return 'queued';
    }

    function attachmentLabel(card, attachment) {
      return attachmentState(card, attachment) === 'used' ? 'Used' : 'Queued';
    }

    function cardAttachmentSummary(card) {
      const attachments = Array.isArray(card && card.attachments) ? card.attachments : [];
      if (!attachments.length) return null;
      const queuedCount = attachments.filter(att => !att.lastUsedAt).length;
      const usedCount = attachments.filter(att => !!att.lastUsedAt).length;
      if (queuedCount > 0) {
        return {
          label: '📎 ' + queuedCount + ' queued',
          title: queuedCount === 1 ? '1 image queued for the next run' : queuedCount + ' images queued for the next run',
        };
      }
      if (usedCount > 0) {
        return {
          label: '📎 ' + usedCount + ' used',
          title: usedCount === 1 ? '1 image included in the last run' : usedCount + ' images included in the last run',
        };
      }
      return {
        label: '📎 ' + attachments.length + ' attached',
        title: attachments.length === 1 ? '1 image attached' : attachments.length + ' images attached',
      };
    }

    function attachmentUrl(cardId, attachmentId) {
      return BASE_PATH + '/api/cards/' + encodeURIComponent(cardId) + '/attachments/' + encodeURIComponent(attachmentId);
    }

    function clearAttachmentError() {
      const error = document.getElementById('modal-attachments-error');
      if (!error) return;
      error.textContent = '';
      error.classList.add('hidden');
    }

    function showAttachmentError(message) {
      const error = document.getElementById('modal-attachments-error');
      if (!error) return;
      error.textContent = message || 'Attachment action failed.';
      error.classList.remove('hidden');
    }

    function openAttachmentPicker() {
      const input = document.getElementById('modal-attachments-input');
      if (input && !attachmentUploadInFlight) input.click();
    }

    function handleAttachmentPreviewError(imgEl) {
      if (!imgEl) return;
      imgEl.style.display = 'none';
      const fallback = imgEl.parentElement && imgEl.parentElement.querySelector('.attachment-fallback');
      if (fallback) fallback.style.display = 'flex';
    }

    function openAttachmentPreview(attachmentId) {
      if (!currentCardId) return;
      const modal = document.getElementById('attachment-preview-modal');
      const image = document.getElementById('attachment-preview-image');
      if (!modal || !image) return;
      image.src = attachmentUrl(currentCardId, attachmentId);
      modal.classList.remove('hidden');
    }

    function closeAttachmentPreview() {
      const modal = document.getElementById('attachment-preview-modal');
      const image = document.getElementById('attachment-preview-image');
      if (image) image.src = '';
      if (modal) modal.classList.add('hidden');
    }

    function renderAttachmentSection(card) {
      const attachments = Array.isArray(card && card.attachments) ? card.attachments : [];
      const strip = document.getElementById('modal-attachments-strip');
      const empty = document.getElementById('modal-attachments-empty');
      const dropzone = document.getElementById('modal-attachments-dropzone');
      const input = document.getElementById('modal-attachments-input');
      if (!strip || !empty || !dropzone || !input) return;

      strip.innerHTML = attachments.map(attachment => {
        const state = attachmentState(card, attachment);
        const label = attachmentLabel(card, attachment);
        const fileTitle = attachment.originalName || 'attachment';
        return ''
          + '<div class="attachment-card">'
          +   '<button class="attachment-thumb" type="button" data-attachment-id="' + escHtml(attachment.id) + '" onclick="openAttachmentPreview(this.dataset.attachmentId)" title="' + escHtml(fileTitle) + '">'
          +     '<img src="' + escHtml(attachmentUrl(card.id, attachment.id)) + '" alt="' + escHtml(fileTitle) + '" loading="lazy" onerror="handleAttachmentPreviewError(this)">'
          +     '<div class="attachment-fallback">Preview unavailable</div>'
          +   '</button>'
          +   '<button class="attachment-remove" type="button" data-attachment-id="' + escHtml(attachment.id) + '" onclick="removeAttachment(this.dataset.attachmentId)" aria-label="Remove ' + escHtml(fileTitle) + '" title="Remove ' + escHtml(fileTitle) + '">×</button>'
          +   '<div class="attachment-status attachment-status--' + escHtml(state) + '">' + escHtml(label) + '</div>'
          +   '<div class="attachment-name" title="' + escHtml(fileTitle) + '">' + escHtml(fileTitle) + '</div>'
          + '</div>';
      }).join('');

      empty.classList.toggle('hidden', attachments.length > 0);
      dropzone.classList.toggle('is-disabled', attachmentUploadInFlight);
      input.disabled = attachmentUploadInFlight;
    }

    async function uploadAttachments(files) {
      if (!currentCardId || !files || !files.length || attachmentUploadInFlight) return;
      attachmentUploadInFlight = true;
      clearAttachmentError();
      const dropzone = document.getElementById('modal-attachments-dropzone');
      if (dropzone) dropzone.classList.add('drag-active');
      try {
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch(BASE_PATH + '/api/cards/' + encodeURIComponent(currentCardId) + '/upload', {
            method: 'POST',
            body: form,
            credentials: 'include',
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || ('Upload failed with HTTP ' + res.status));
          }
        }
        await refreshState();
      } catch (err) {
        showAttachmentError(err.message || 'Upload failed.');
      } finally {
        attachmentUploadInFlight = false;
        if (dropzone) dropzone.classList.remove('drag-active');
        const input = document.getElementById('modal-attachments-input');
        if (input) input.value = '';
        const liveCard = currentCardId ? findCard(currentCardId) : null;
        if (liveCard) renderAttachmentSection(liveCard);
      }
    }

    function handleAttachmentInputChange(event) {
      const files = event && event.target ? event.target.files : null;
      void uploadAttachments(files);
    }

    function handleAttachmentDragOver(event) {
      event.preventDefault();
      const dropzone = document.getElementById('modal-attachments-dropzone');
      if (dropzone) dropzone.classList.add('drag-active');
    }

    function handleAttachmentDragLeave(event) {
      event.preventDefault();
      const dropzone = document.getElementById('modal-attachments-dropzone');
      if (dropzone) dropzone.classList.remove('drag-active');
    }

    function handleAttachmentDrop(event) {
      event.preventDefault();
      const dropzone = document.getElementById('modal-attachments-dropzone');
      if (dropzone) dropzone.classList.remove('drag-active');
      const files = event && event.dataTransfer ? event.dataTransfer.files : null;
      void uploadAttachments(files);
    }

    async function removeAttachment(attachmentId) {
      if (!currentCardId || !attachmentId) return;
      clearAttachmentError();
      try {
        await apiFetch('/api/cards/' + currentCardId + '/attachments/' + attachmentId, {
          method: 'DELETE',
        });
        await refreshState();
      } catch (err) {
        showAttachmentError(err.message || 'Failed to remove image.');
      }
    }

    // ─── Rendering ───────────────────────────────────────────────────────────

    async function ensureModelCatalogLoaded(force = false) {
      if (!force && modelCatalog.length > 0) return modelCatalog;
      if (!force && modelCatalogPromise) return modelCatalogPromise;
      modelCatalogPromise = apiFetch('/api/models')
        .then(data => {
          modelCatalog = Array.isArray(data?.options) ? data.options : [];
          defaultModelRef = data?.defaultRef || null;
          modelCatalogError = null;
          modelCatalogPromise = null;
          return modelCatalog;
        })
        .catch(err => {
          modelCatalogError = err.message || 'Failed to load models';
          modelCatalogPromise = null;
          throw err;
        });
      return modelCatalogPromise;
    }

    function findModelOption(ref) {
      if (!ref) return null;
      const needle = String(ref).trim().toLowerCase();
      return modelCatalog.find(option => String(option.ref || '').trim().toLowerCase() === needle) || null;
    }

    function populateModelSelect(card) {
      const select = document.getElementById('modal-model-select');
      const currentRef = card?.modelRef || '';
      const currentOption = findModelOption(currentRef);
      const options = [
        '<option value="">Use default model</option>',
        ...modelCatalog.map(option =>
          '<option value="' + escHtml(option.ref) + '"' + (option.ref === currentRef ? ' selected' : '') + '>' + escHtml(option.label) + '</option>'
        ),
      ];
      if (currentRef && !currentOption) {
        options.splice(1, 0, '<option value="' + escHtml(currentRef) + '" selected>Model unavailable</option>');
      }
      select.innerHTML = options.join('');
      select.disabled = false;
    }

    function clearModelSaveError() {
      const error = document.getElementById('modal-model-error');
      error.textContent = '';
      error.classList.add('hidden');
    }

    function showModelSaveError(message) {
      const error = document.getElementById('modal-model-error');
      error.textContent = message || 'Failed to save model changes.';
      error.classList.remove('hidden');
    }

    function syncModelField(card) {
      const select = document.getElementById('modal-model-select');
      const helper = document.getElementById('modal-model-helper');
      const sessionHelp = document.getElementById('modal-model-session-help');
      const warning = document.getElementById('modal-model-warning');
      const ref = document.getElementById('modal-model-ref');
      const currentRef = card?.modelRef || '';
      const currentOption = findModelOption(currentRef);
      const isUnavailable = !!currentRef && !currentOption;

      if (modelCatalog.length > 0) {
        populateModelSelect(card);
        select.disabled = false;
      } else {
        const selectLabel = isUnavailable ? 'Model unavailable' : (currentRef || 'Use default model');
        select.innerHTML = '<option value="">' + escHtml(selectLabel) + '</option>';
        select.disabled = true;
      }

      if (!currentRef) {
        helper.textContent = 'Uses the agent default unless you choose a specific model.';
        sessionHelp.textContent = '';
        sessionHelp.classList.add('hidden');
        warning.textContent = '';
        warning.classList.add('hidden');
        ref.textContent = '';
        ref.classList.add('hidden');
      } else if (isUnavailable) {
        helper.textContent = '';
        sessionHelp.textContent = '';
        sessionHelp.classList.add('hidden');
        warning.innerHTML = '⚠ Saved model is no longer configured on this gateway.<br>Choose another model or clear back to default.';
        warning.classList.remove('hidden');
        ref.textContent = 'Canonical ref: ' + currentRef;
        ref.classList.remove('hidden');
      } else {
        helper.textContent = 'Applies to future stage runs on this card’s durable thread. History stays intact.';
        warning.textContent = '';
        warning.classList.add('hidden');
        ref.textContent = 'Canonical ref: ' + currentRef;
        ref.classList.remove('hidden');
        if (card.sessionId) {
          sessionHelp.textContent = 'Updates the bound session for future runs.';
          sessionHelp.classList.remove('hidden');
        } else {
          sessionHelp.textContent = '';
          sessionHelp.classList.add('hidden');
        }
      }

      if (modelCatalogError) {
        helper.textContent = 'Model list unavailable right now. Try again in a moment.';
        if (currentRef) {
          ref.textContent = 'Canonical ref: ' + currentRef;
          ref.classList.remove('hidden');
        }
      }
    }

    function syncAttentionInputs() {
      const modeSelect = document.getElementById('modal-attention-mode');
      const mode = modeSelect.value;
      const reasonInput = document.getElementById('modal-attention-reason');
      if (modeSelect.disabled) {
        reasonInput.disabled = true;
        return;
      }
      const enabled = mode === 'waiting_on_patrick';
      reasonInput.disabled = !enabled;
      if (!enabled) {
        reasonInput.value = '';
      }
    }

    function applyUpdatedCardToBoardState(updatedCard) {
      if (!boardState || !updatedCard || !updatedCard.id) return;
      const cards = Array.isArray(boardState.cards) ? [...boardState.cards] : [];
      const idx = cards.findIndex(card => card.id === updatedCard.id);
      if (idx === -1) return;
      cards[idx] = updatedCard;
      boardState = { ...boardState, cards };
      lastStateJSON = JSON.stringify(boardState);
      renderBoard(boardState);
      syncOpenCardModal();
    }

    async function markCardRead(cardId, force = false) {
      if (!cardId) return;
      const card = findCard(cardId);
      const derived = card && card.derived ? card.derived : null;
      if (!force && (!derived || (!derived.hasUnreadOutput && !derived.unreadCommentCount))) {
        return;
      }
      if (readMarkInFlightForCardId === cardId) return;
      readMarkInFlightForCardId = cardId;
      try {
        const updatedCard = await apiFetch('/api/cards/' + cardId + '/read', { method: 'POST' });
        applyUpdatedCardToBoardState(updatedCard);
      } catch (err) {
        console.error('Failed to mark card read:', err);
      } finally {
        if (readMarkInFlightForCardId === cardId) {
          readMarkInFlightForCardId = null;
        }
      }
    }

    function maybeMarkOpenCardRead() {
      const modal = document.getElementById('card-modal');
      if (!currentCardId || modal.classList.contains('hidden')) return;
      void markCardRead(currentCardId, false);
    }

    async function loadCardActivity(cardId) {
      if (!cardId) return [];
      try {
        const activity = await apiFetch('/api/cards/' + cardId + '/activity');
        if (currentCardId === cardId) {
          currentCardActivity = Array.isArray(activity) ? activity : [];
          renderActivityTrail(currentCardActivity);
        }
        return activity;
      } catch (err) {
        if (currentCardId === cardId) {
          currentCardActivity = [];
          renderActivityTrail([]);
        }
        throw err;
      }
    }

    function renderBoard(state) {
      const board = document.getElementById('board');

      // Build a map of columnId → cards
      const cardsByColumn = {};
      COLUMNS.forEach(c => { cardsByColumn[c.id] = []; });
      (state.cards || []).forEach(card => {
        const col = card.column || 'backlog';
        if (!cardsByColumn[col]) cardsByColumn['backlog'].push(card);
        else cardsByColumn[col].push(card);
      });

      // Check if we can do a targeted update vs full re-render.
      // Once columns exist, keep header DOM intact so native <details> state survives polling.
      const existingColumns = board.querySelectorAll('.column');
      if (existingColumns.length === COLUMNS.length) {
        // Targeted update: just re-render card lists
        COLUMNS.forEach(col => {
          const colEl = board.querySelector('[data-column-id="' + col.id + '"]');
          if (!colEl) return;
          const cardsContainer = colEl.querySelector('.column-cards');
          const count = cardsByColumn[col.id].length;
          const countEl = colEl.querySelector('.column-count');
          if (countEl) countEl.textContent = count;
          cardsContainer.innerHTML = renderCards(cardsByColumn[col.id], col);
          attachCardEvents(cardsContainer);
        });
      } else {
        // Full re-render
        board.innerHTML = COLUMNS.map(col => renderColumn(col, cardsByColumn[col.id])).join('');
        board.querySelectorAll('.column').forEach(attachColumnDragEvents);
        board.querySelectorAll('.column-cards').forEach(attachCardEvents);
      }
    }

    function renderColumn(col, cards) {
      const count = cards.length;
      const summaryHtml = col.summary
        ? '<div class="column-summary">' + escHtml(col.summary) + '</div>'
        : '';
      const outcomeHtml = col.outcome
        ? '<div class="column-outcome"><span class="column-outcome-label">Produces:</span>' + escHtml(col.outcome) + '</div>'
        : '';
      const corePillHtml = col.isCoreFlow ? '<span class="column-core-pill">Core</span>' : '';
      const utilityHtml = (corePillHtml || col.skill)
        ? '<div class="column-utility-row">'
          + corePillHtml
          + (col.skill ? '<span class="column-skill">' + escHtml(col.skill) + '</span>' : '')
          + '</div>'
        : '';
      const detailsHtml = col.detail
        ? '<details class="column-details">'
          + '<summary class="column-details-toggle">'
          + '<span class="column-details-toggle-copy">'
          + '<span class="column-details-label-more">More</span>'
          + '<span class="column-details-label-less">Less</span>'
          + '</span>'
          + '<span class="column-details-chevron" aria-hidden="true">▾</span>'
          + '</summary>'
          + '<div class="column-detail-body">' + escHtml(col.detail)
          + (col.skill ? '<div class="column-detail-skill">' + escHtml(col.skill) + '</div>' : '')
          + '</div>'
          + '</details>'
        : '';
      const headerClass = 'column-header' + (col.isCoreFlow ? ' column-header--core' : '');
      return \`
        <div class="column" data-column-id="\${col.id}">
          <div class="\${headerClass}">
            <div class="flex items-center justify-between mb-0.5">
              <span class="text-xs font-semibold uppercase tracking-wider text-gray-300">\${escHtml(col.name)}</span>
              <span class="column-count">\${count}</span>
            </div>
            \${summaryHtml}
            \${outcomeHtml}
            \${utilityHtml}
            \${detailsHtml}
          </div>
          <div class="column-cards">
            \${renderCards(cards, col)}
          </div>
        </div>
      \`;
    }

    function renderCards(cards, col) {
      if (cards.length === 0) {
        return \`<div class="empty-column-hint">Drop cards here</div>\`;
      }
      return cards.map(card => renderCard(card)).join('');
    }

    function capUnreadCount(count) {
      return count > 9 ? '9+' : String(count);
    }

    function renderAttentionChip(card) {
      const derived = card.derived || {};
      const unreadCommentCount = Number(derived.unreadCommentCount || 0);
      const hasUnreadOutput = !!derived.hasUnreadOutput;
      const needsPatrick = card.attentionMode === 'waiting_on_patrick' || derived.attentionLevel === 'patrick';

      if (needsPatrick) {
        if (unreadCommentCount > 0) {
          const label = unreadCommentCount === 1 ? '1 unread comment' : capUnreadCount(unreadCommentCount) + ' unread comments';
          return '<span class="attention-chip attention-chip--comments" aria-label="' + escHtml(label) + '" title="' + escHtml(label) + '">' + escHtml(capUnreadCount(unreadCommentCount)) + '</span>';
        }
        return '';
      }

      if (unreadCommentCount > 0) {
        const label = unreadCommentCount === 1 ? '1 unread comment' : capUnreadCount(unreadCommentCount) + ' unread comments';
        return '<span class="attention-chip attention-chip--comments" aria-label="' + escHtml(label) + '" title="' + escHtml(label) + '">' + escHtml(capUnreadCount(unreadCommentCount)) + '</span>';
      }

      if (hasUnreadOutput) {
        return '<span class="attention-chip attention-chip--output" aria-label="New unread output" title="New unread output"></span>';
      }

      return '';
    }

    function renderAttentionPill(card) {
      const derived = card.derived || {};
      const needsPatrick = card.attentionMode === 'waiting_on_patrick' || derived.attentionLevel === 'patrick';
      if (!needsPatrick) return '';
      const title = card.attentionReason ? ' title="' + escHtml(card.attentionReason) + '"' : '';
      const label = card.status === 'awaiting_human' ? 'Awaiting Human' : 'Needs Patrick';
      return '<div class="attention-pill-row"><span class="attention-pill" aria-label="' + escHtml(label) + '"' + title + '>' + escHtml(label) + '</span></div>';
    }

    function renderCard(card) {
      const status = card.status || 'idle';
      const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
      const tags = (card.tags || []);
      const tagsHtml = tags.length > 0
        ? '<div class="flex flex-wrap mt-2">' + tags.map(t => '<span class="tag-badge">' + escHtml(t) + '</span>').join('') + '</div>'
        : '';
      const modelBadgeHtml = card.modelBadgeLabel
        ? '<div class="mt-2"><span class="model-badge' + (card.modelState === 'unavailable' ? ' unavailable' : '') + '">' + escHtml(card.modelBadgeLabel) + '</span></div>'
        : '';
      const attachmentSummary = cardAttachmentSummary(card);
      const attachmentIndicatorHtml = attachmentSummary
        ? '<div class="card-attachment-indicator" title="' + escHtml(attachmentSummary.title) + '">' + escHtml(attachmentSummary.label) + '</div>'
        : '';
      const runningClass = status === 'running' ? ' running' : '';
      const sessionHtml = card.sessionId
        ? '<div class="text-xs text-gray-500 mt-2">OpenClaw · ' + escHtml(String(card.sessionId).slice(0, 8)) + '</div>'
        : '';
      const skillHtml = card.skillTriggered
        ? '<div class="text-xs text-blue-400 font-mono mt-2 truncate">' + escHtml(card.skillTriggered) + '</div>'
        : '';
      const titleChipHtml = renderAttentionChip(card);
      const attentionPillHtml = renderAttentionPill(card);
      const questionPreviewHtml = status === 'awaiting_human' && card.attentionReason
        ? '<div class="question-preview">⁉️ ' + escHtml(card.attentionReason.length > 120 ? card.attentionReason.slice(0, 120) + '…' : card.attentionReason) + '</div>'
        : '';
      const cardClasses = 'card'
        + ((card.attentionMode === 'waiting_on_patrick' || (card.derived && card.derived.attentionLevel === 'patrick')) ? ' card--needs-patrick' : '')
        + (status === 'awaiting_human' ? ' awaiting-human' : '');

      return \`
        <div class="\${cardClasses}"
          data-card-id="\${escHtml(card.id)}"
          \${!isMobile ? 'draggable="true"' : ''}
          onclick="openCardModal('\${escHtml(card.id)}')"
        >
          <div class="flex items-start gap-2">
            <span class="status-dot\${runningClass}" style="background:\${color};margin-top:5px;flex-shrink:0;"></span>
            <span class="text-sm font-medium text-gray-100 leading-snug flex-1">\${escHtml(card.title || 'Untitled')}</span>
            \${titleChipHtml}
          </div>
          \${attentionPillHtml}
          \${questionPreviewHtml}
          \${attachmentIndicatorHtml}
          \${tagsHtml}
          \${modelBadgeHtml}
          \${skillHtml}
          \${sessionHtml}
        </div>
      \`;
    }

    // ─── Drag and Drop ───────────────────────────────────────────────────────

    function attachColumnDragEvents(colEl) {
      colEl.addEventListener('dragover', e => {
        e.preventDefault();
        colEl.classList.add('drag-over');
      });
      colEl.addEventListener('dragleave', e => {
        if (!colEl.contains(e.relatedTarget)) {
          colEl.classList.remove('drag-over');
        }
      });
      colEl.addEventListener('drop', e => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        const cardId = e.dataTransfer.getData('text/plain');
        const colId = colEl.dataset.columnId;
        if (cardId && colId && findColumnForCard(cardId) !== colId) {
          moveCard(cardId, colId);
        }
      });
    }

    function attachCardEvents(container) {
      if (isMobile) return;
      container.querySelectorAll('.card[draggable]').forEach(cardEl => {
        cardEl.addEventListener('dragstart', e => {
          dragCardId = cardEl.dataset.cardId;
          e.dataTransfer.setData('text/plain', dragCardId);
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => cardEl.classList.add('dragging'), 0);
        });
        cardEl.addEventListener('dragend', () => {
          cardEl.classList.remove('dragging');
          dragCardId = null;
          document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
        });
      });
    }

    // ─── Card Modal ───────────────────────────────────────────────────────────

    function findCard(id) {
      if (!boardState) return null;
      return (boardState.cards || []).find(c => c.id === id) || null;
    }

    function findColumnForCard(id) {
      const card = findCard(id);
      return card ? (card.column || 'backlog') : 'backlog';
    }

    function refreshModalReadOnlyFields(card) {
      if (!card) return;

      // Status display
      const status = card.status || 'idle';
      const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
      const label = STATUS_LABELS[status] || status;
      const runningClass = status === 'running' ? ' running' : '';
      document.getElementById('modal-status-display').innerHTML =
        \`<span class="status-dot\${runningClass}" style="background:\${color};"></span><span class="text-gray-300">\${escHtml(label)}</span>\`;

      // Column select
      const colSelect = document.getElementById('modal-column-select');
      colSelect.innerHTML = COLUMNS.map(c =>
        \`<option value="\${c.id}" \${c.id === (card.column || 'backlog') ? 'selected' : ''}>\${escHtml(c.name)}</option>\`
      ).join('');

      const attentionModeSelect = document.getElementById('modal-attention-mode');
      const attentionReasonInput = document.getElementById('modal-attention-reason');
      const attentionHelp = document.getElementById('modal-attention-help');
      const attentionLocked = card.status === 'awaiting_human';
      attentionModeSelect.value = card.attentionMode || 'none';
      attentionReasonInput.value = card.attentionReason || '';
      attentionModeSelect.disabled = attentionLocked;
      attentionReasonInput.disabled = attentionLocked;
      attentionHelp.textContent = attentionLocked
        ? 'This card is waiting on an active agent question. Reply below to resume the same durable thread.'
        : 'Opening the modal marks unread output and unread comments as read. Patrick-specific attention stays active until you clear it.';
      syncAttentionInputs();

      renderAttachmentSection(card);

      // Skill
      const skillSection = document.getElementById('modal-skill-section');
      const skillDisplay = document.getElementById('modal-skill-display');
      if (card.skillTriggered) {
        skillDisplay.textContent = card.skillTriggered;
        skillSection.classList.remove('hidden');
      } else {
        skillSection.classList.add('hidden');
      }

      // Model field
      syncModelField(card);

      // Durable session info
      const sessionDisplay = document.getElementById('modal-session-display');
      if (card.sessionId) {
        const lines = [
          'Durable card thread is linked.',
          'sessionId: ' + card.sessionId,
          card.sessionKey ? 'sessionKey: ' + card.sessionKey : null,
          card.sessionFile ? 'transcript: ' + card.sessionFile : null,
        ].filter(Boolean);
        sessionDisplay.textContent = lines.join('\\n');
      } else {
        sessionDisplay.textContent = 'No OpenClaw session yet. The first move into a skill-backed stage creates and binds a durable work thread for this card.';
      }

      const questionSection = document.getElementById('modal-question-section');
      const questionText = document.getElementById('modal-question-text');
      const replyInput = document.getElementById('reply-input');
      const replyButton = document.getElementById('reply-submit-button');
      const commentRow = document.getElementById('activity-comment-row');
      if (card.status === 'awaiting_human' && card.attentionReason) {
        questionText.textContent = card.attentionReason;
        questionSection.classList.remove('hidden');
        commentRow.classList.add('hidden');
        replyInput.disabled = false;
        replyButton.disabled = false;
      } else {
        questionText.textContent = '';
        questionSection.classList.add('hidden');
        commentRow.classList.remove('hidden');
        replyInput.value = '';
        replyInput.disabled = true;
        replyButton.disabled = true;
      }

      // Activity trail
      renderActivityTrail(currentCardId === card.id ? currentCardActivity : []);
    }

    function syncOpenCardModal() {
      const modal = document.getElementById('card-modal');
      if (!currentCardId || modal.classList.contains('hidden')) return;
      const card = findCard(currentCardId);
      if (!card) return;
      refreshModalReadOnlyFields(card);
      maybeMarkOpenCardRead();
      void loadCardActivity(currentCardId);
    }

    function openCardModal(cardId) {
      const card = findCard(cardId);
      if (!card) return;
      currentCardId = cardId;
      currentCardActivity = [];

      document.getElementById('modal-title').value = card.title || '';
      document.getElementById('modal-description').value = card.description || '';
      document.getElementById('modal-tags').value = (card.tags || []).join(', ');
      modelCatalogError = null;
      clearModelSaveError();
      clearAttachmentError();
      closeAttachmentPreview();
      refreshModalReadOnlyFields(card);
      document.getElementById('activity-comment-input').value = '';
      document.getElementById('reply-input').value = '';

      // Reset log
      document.getElementById('log-section').classList.add('hidden');
      document.getElementById('log-content').textContent = '';

      document.getElementById('card-modal').classList.remove('hidden');
      void loadCardActivity(cardId);
      void markCardRead(cardId, true);
      ensureModelCatalogLoaded()
        .then(() => {
          const liveCard = findCard(cardId) || card;
          syncModelField(liveCard);
        })
        .catch(() => {
          const liveCard = findCard(cardId) || card;
          syncModelField(liveCard);
        });
    }

    function closeCardModal() {
      document.getElementById('card-modal').classList.add('hidden');
      closeAttachmentPreview();
      currentCardId = null;
      currentCardActivity = [];
    }

    async function saveCardEdits() {
      if (!currentCardId) return;
      const title = document.getElementById('modal-title').value.trim();
      const description = document.getElementById('modal-description').value.trim();
      const tagsRaw = document.getElementById('modal-tags').value;
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const modelRef = document.getElementById('modal-model-select').value || null;
      const liveCard = findCard(currentCardId);
      const isAwaitingHuman = !!liveCard && liveCard.status === 'awaiting_human';
      const attentionMode = document.getElementById('modal-attention-mode').value;
      const attentionReasonInput = document.getElementById('modal-attention-reason');
      const attentionReason = attentionMode === 'waiting_on_patrick' ? attentionReasonInput.value.trim() : null;
      const payload = { title, description, tags, modelRef };
      if (!isAwaitingHuman) {
        payload.attentionMode = attentionMode;
        payload.attentionReason = attentionReason;
      }

      clearModelSaveError();

      try {
        await apiFetch('/api/cards/' + currentCardId, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        await refreshState();
        closeCardModal();
      } catch (err) {
        showModelSaveError(err.message || 'Failed to save changes.');
      }
    }

    async function moveCardFromModal(columnId) {
      if (!currentCardId) return;
      await moveCard(currentCardId, columnId);
    }

    async function deleteCurrentCard() {
      if (!currentCardId) return;
      if (!confirm('Delete this card? This cannot be undone.')) return;
      try {
        await apiFetch(\`/api/cards/\${currentCardId}\`, { method: 'DELETE' });
        closeCardModal();
        await refreshState();
      } catch (err) {
        alert('Failed to delete: ' + err.message);
      }
    }

    async function fetchAndShowLog() {
      if (!currentCardId) return;
      const logSection = document.getElementById('log-section');
      const logContent = document.getElementById('log-content');
      logSection.classList.remove('hidden');
      logContent.textContent = 'Loading...';
      try {
        const res = await fetch(BASE_PATH + \`/api/cards/\${currentCardId}/log\`, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        logContent.textContent = text || '(no log output)';
        logContent.scrollTop = logContent.scrollHeight;
      } catch (err) {
        logContent.textContent = 'Failed to load log: ' + err.message;
      }
    }

    async function copySessionResumeCommand() {
      if (!currentCardId) return;
      const card = findCard(currentCardId);
      if (!card || !card.sessionId) {
        alert('This card does not have a durable session yet. Move it into a skill-backed stage first.');
        return;
      }
      const command = \`openclaw agent --session-id \${card.sessionId} --message "Continue where you left off."\`;
      try {
        await navigator.clipboard.writeText(command);
      } catch {
        prompt('Copy resume command:', command);
      }
    }

    // ─── Activity Trail ──────────────────────────────────────────────────────

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

    function activityMetaFor(entry) {
      const key = String(entry && entry.type ? entry.type : '');
      return Object.prototype.hasOwnProperty.call(ACTIVITY_META, key)
        ? ACTIVITY_META[key]
        : ACTIVITY_META.unknown_event;
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

    function columnLabel(value) {
      if (!value) return 'Unknown stage';
      const match = COLUMNS.find(column => column.id === value);
      return match ? match.name : String(value);
    }

    function statusLabel(value) {
      if (!value) return 'Unknown status';
      return STATUS_LABELS[value] || String(value).replace(/_/g, ' ').replace(/\\b\\w/g, char => char.toUpperCase());
    }

    function renderActivityText(text) {
      return escHtml(String(text || '')).replace(/\\n/g, '<br>');
    }

    function renderActivityDelta(fromLabel, toLabel) {
      return '<div class="activity-delta">'
        + '<span class="activity-chip">' + escHtml(fromLabel) + '</span>'
        + '<span class="activity-arrow">→</span>'
        + '<span class="activity-chip">' + escHtml(toLabel) + '</span>'
        + '</div>';
    }

    function renderSystemActivityBody(entry) {
      const type = String(entry && entry.type ? entry.type : 'unknown_event');
      const stage = columnLabel(entry.column || entry.toColumn);
      const sessionSuffix = entry.sessionId ? ' · ' + escHtml(String(entry.sessionId).slice(0, 8)) : '';
      if (type === 'card_created') return '<div class="activity-body activity-body--system">Card created</div>';
      if (type === 'session_linked') return '<div class="activity-body activity-body--system">Durable thread linked' + sessionSuffix + '</div>';
      if (type === 'run_started') {
        const verb = /resum/i.test(String(entry.text || '')) ? 'Resumed' : 'Started';
        return '<div class="activity-body activity-body--system">' + escHtml(verb + ' ' + stage) + sessionSuffix + '</div>';
      }
      if (type === 'run_completed') return '<div class="activity-body activity-body--system">' + escHtml(stage + ' completed') + '</div>';
      if (type === 'run_failed') {
        const exitSuffix = typeof entry.exitCode === 'number' ? ' (exit ' + String(entry.exitCode) + ')' : '';
        return '<div class="activity-body activity-body--system">' + escHtml(stage + ' failed' + exitSuffix) + '</div>';
      }
      if (type === 'run_cancelled') {
        const reason = entry.reason ? ' — ' + String(entry.reason) : '';
        return '<div class="activity-body activity-body--system">' + escHtml('Run cancelled' + reason) + '</div>';
      }
      return '<div class="activity-body activity-body--system">' + renderActivityText(entry.text || 'System event') + '</div>';
    }

    function renderActivityBody(entry) {
      const type = String(entry && entry.type ? entry.type : 'unknown_event');
      if (type === 'stage_changed' && entry.fromColumn && entry.toColumn) {
        return renderActivityDelta(columnLabel(entry.fromColumn), columnLabel(entry.toColumn));
      }
      if (type === 'status_changed' && entry.fromStatus && entry.toStatus) {
        return renderActivityDelta(statusLabel(entry.fromStatus), statusLabel(entry.toStatus));
      }
      if (type === 'agent_comment' || type === 'human_comment' || type === 'agent_question' || type === 'human_reply') {
        return '<div class="activity-body activity-body--comment">' + renderActivityText(entry.text) + '</div>';
      }
      return renderSystemActivityBody(entry);
    }

    function renderActivityTrail(activity) {
      const container = document.getElementById('modal-activity');
      if (!activity || activity.length === 0) {
        container.innerHTML = '<div class="activity-empty">No timeline yet.<br>This card has not recorded workflow activity or comments.</div>';
        return;
      }
      const sorted = [...activity].reverse();
      let lastDayLabel = null;
      const parts = [];
      sorted.forEach(entry => {
        const dayLabel = formatActivityDayLabel(entry.timestamp);
        if (dayLabel && dayLabel !== lastDayLabel) {
          parts.push('<div class="activity-separator">' + escHtml(dayLabel) + '</div>');
          lastDayLabel = dayLabel;
        }
        const meta = activityMetaFor(entry);
        parts.push(
          '<div class="activity-entry activity-entry--' + meta.family + '">'
            + '<div class="activity-icon activity-icon--' + meta.family + '">' + meta.icon + '</div>'
            + '<div class="activity-main">'
              + '<div class="activity-head">'
                + '<span class="activity-label">' + escHtml(meta.label) + '</span>'
                + '<span class="activity-time">' + formatActivityTime(entry.timestamp) + '</span>'
              + '</div>'
              + renderActivityBody(entry)
            + '</div>'
          + '</div>'
        );
      });
      container.innerHTML = parts.join('');
    }

    async function submitComment() {
      if (!currentCardId) return;
      const input = document.getElementById('activity-comment-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const activity = await apiFetch('/api/cards/' + currentCardId + '/activity', {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        currentCardActivity = Array.isArray(activity) ? activity : [];
        renderActivityTrail(currentCardActivity);
        void markCardRead(currentCardId, true);
      } catch (err) {
        alert('Failed to add comment: ' + err.message);
      }
    }

    async function submitReply() {
      if (!currentCardId) return;
      const input = document.getElementById('reply-input');
      const button = document.getElementById('reply-submit-button');
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }

      input.disabled = true;
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = 'Sending…';
      try {
        await apiFetch('/api/cards/' + currentCardId + '/reply', {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        input.value = '';
        await refreshState();
      } catch (err) {
        alert('Failed to send reply: ' + err.message);
      } finally {
        const liveCard = findCard(currentCardId);
        const stillAwaiting = liveCard && liveCard.status === 'awaiting_human';
        input.disabled = !stillAwaiting;
        button.disabled = !stillAwaiting;
        button.textContent = originalLabel;
      }
    }

    // ─── Add Card Modal ───────────────────────────────────────────────────────

    function openAddModal() {
      document.getElementById('add-title').value = '';
      document.getElementById('add-description').value = '';
      document.getElementById('add-tags').value = '';
      document.getElementById('add-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('add-title').focus(), 50);
    }

    function closeAddModal() {
      document.getElementById('add-modal').classList.add('hidden');
    }

    async function submitAddCard() {
      const title = document.getElementById('add-title').value.trim();
      if (!title) {
        document.getElementById('add-title').focus();
        return;
      }
      const description = document.getElementById('add-description').value.trim();
      const tagsRaw = document.getElementById('add-tags').value;
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

      try {
        await apiFetch('/api/cards', {
          method: 'POST',
          body: JSON.stringify({ title, description, tags }),
        });
        closeAddModal();
        await refreshState();
      } catch (err) {
        alert('Failed to create card: ' + err.message);
      }
    }

    // ─── Login ────────────────────────────────────────────────────────────────

    function showLogin() {
      document.getElementById('login-page').classList.remove('hidden');
      document.getElementById('board').style.display = 'none';
      document.querySelector('header').style.display = 'none';
      setTimeout(() => document.getElementById('login-password').focus(), 50);
      fetchLoginInfo();
    }

    async function fetchLoginInfo() {
      try {
        const res = await fetch(BASE_PATH + '/api/info');
        if (!res.ok) return;
        const info = await res.json();
        const el = document.getElementById('login-info');
        const uptime = formatUptime(info.uptime);
        const lines = [
          \`v\${info.version} · \${info.runtime}\`,
          \`Up \${uptime} · \${info.cards} card\${info.cards !== 1 ? 's' : ''}\`,
          info.executionMode === 'durable-openclaw-session'
            ? 'Durable OpenClaw sessions enabled'
            : 'Execution mode unavailable',
        ];
        el.innerHTML = lines.map(l => \`<div>\${l}</div>\`).join('');
      } catch {}
    }

    function formatUptime(seconds) {
      if (seconds < 60) return seconds + 's';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
      return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
    }

    function hideLogin() {
      document.getElementById('login-page').classList.add('hidden');
      document.getElementById('board').style.display = '';
      document.querySelector('header').style.display = '';
    }

    async function submitLogin() {
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      try {
        const res = await fetch(BASE_PATH + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => 'Invalid password');
          errEl.textContent = text || 'Invalid password';
          errEl.classList.remove('hidden');
          return;
        }
        hideLogin();
        startPolling();
      } catch (err) {
        errEl.textContent = 'Network error: ' + err.message;
        errEl.classList.remove('hidden');
      }
    }

    // ─── API ─────────────────────────────────────────────────────────────────

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
        showLogin();
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

    async function refreshState() {
      try {
        const state = await apiFetch('/api/state');
        const stateJSON = JSON.stringify(state);
        if (stateJSON !== lastStateJSON) {
          lastStateJSON = stateJSON;
          boardState = state;
          renderBoard(state);
          syncOpenCardModal();
        }
        setPollIndicator(true);
        // Fetch header info once on first successful load
        if (!headerInfoLoaded) {
          headerInfoLoaded = true;
          fetchHeaderInfo();
        }
      } catch (err) {
        if (err.message !== 'Unauthorized') {
          console.error('Poll error:', err);
          setPollIndicator(false);
        }
      }
    }

    let headerInfoLoaded = false;
    async function fetchHeaderInfo() {
      try {
        const res = await fetch(BASE_PATH + '/api/info', { credentials: 'include' });
        if (!res.ok) return;
        const info = await res.json();
        const el = document.getElementById('header-info');
        el.textContent = \`v\${info.version} · \${info.cards} card\${info.cards !== 1 ? 's' : ''}\`;
        el.classList.remove('hidden');
      } catch {}
    }

    async function moveCard(cardId, columnId) {
      if (findColumnForCard(cardId) === columnId) return;
      try {
        await apiFetch(\`/api/cards/\${cardId}/move\`, {
          method: 'POST',
          body: JSON.stringify({ column: columnId }),
        });
        await refreshState();
      } catch (err) {
        if (err.message !== 'Unauthorized') {
          alert('Failed to move card: ' + err.message);
        }
      }
    }

    // ─── Polling ──────────────────────────────────────────────────────────────

    function setPollIndicator(ok) {
      const el = document.getElementById('poll-indicator');
      el.style.background = ok ? '#10B981' : '#EF4444';
      el.title = ok ? 'Connected' : 'Connection error';
    }

    function startPolling() {
      refreshState();
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(refreshState, 2000);
    }

    // ─── Keyboard & Click-outside ─────────────────────────────────────────────

    document.getElementById('card-modal').addEventListener('click', function(e) {
      if (e.target === this) closeCardModal();
    });

    document.getElementById('add-modal').addEventListener('click', function(e) {
      if (e.target === this) closeAddModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeCardModal();
        closeAddModal();
      }
      if (e.key === 'Enter' && !e.shiftKey && document.getElementById('add-modal').contains(document.activeElement)) {
        if (document.activeElement.tagName !== 'TEXTAREA') {
          submitAddCard();
        }
      }
    });

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function escHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    // Render skeleton columns immediately
    (function initSkeleton() {
      const board = document.getElementById('board');
      board.innerHTML = COLUMNS.map(col => renderColumn(col, [])).join('');
      board.querySelectorAll('.column').forEach(attachColumnDragEvents);
    })();

    startPolling();
  </script>
</body>
</html>`;
}
