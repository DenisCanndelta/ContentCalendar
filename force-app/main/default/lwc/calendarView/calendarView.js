import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getRecords from '@salesforce/apex/CalendarViewController.getRecords';

// ── Constants ──────────────────────────────────────────────────────────────
const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const MAX_VISIBLE_MONTHLY = 3;
const MAX_VISIBLE_WEEKLY  = 6;

// Article date-field label → short pill label + CSS class
const DATE_PILL = {
    'Publishing' : { short: 'Pub',   cls: 'date-pill date-pill-pub'   },
    'Writing Due': { short: 'Write', cls: 'date-pill date-pill-write' },
    'Brief Due'  : { short: 'Brief', cls: 'date-pill date-pill-brief' }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDisplay(dateStr) {
    if (!dateStr) return '';
    const [y, m, day] = dateStr.split('-');
    return `${MONTH_NAMES[parseInt(m,10)-1]} ${parseInt(day,10)}, ${y}`;
}

function weekStartOf(d) {
    const s = new Date(d);
    s.setDate(s.getDate() - s.getDay());
    s.setHours(0, 0, 0, 0);
    return s;
}

function approvalMeta(clientApproved) {
    return clientApproved
        ? { label: '✓ Client Approved',  style: 'background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;' }
        : { label: '⏳ Pending Approval', style: 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d;' };
}

function statusShorthand(statusValue, objectType) {
    if (objectType === 'Article') {
        return ({
            'Brief Development' : 'BRF DEV',
            'Writing'           : 'WRT',
            'Quality Assurance' : 'QA',
            'Quality Compliance': 'QC',
            'Need Visuals'      : 'VIS',
            'Client Review'     : 'REV',
            'WordPress Drafting': 'WP DFT',
            'Scheduled'         : 'SCHED',
            'Published'         : 'PUB'
        })[statusValue] || statusValue;
    }
    return ({
        'Work In Progress': 'WIP',
        'Ready for Client': 'Ready',
        'Client Approved' : 'Aprvd',
        'Revisions'       : 'Revise',
        'Scheduled'       : 'Sched'
    })[statusValue] || statusValue;
}

function statusPillClass(statusValue, objectType = 'SocialMediaPost') {
    if (objectType === 'Article') {
        const articleStageMap = {
            'Brief Development' : 'status-pill status-pill-brf-dev',
            'Writing'           : 'status-pill status-pill-wrt',
            'Quality Assurance' : 'status-pill status-pill-qa',
            'Quality Compliance': 'status-pill status-pill-qc',
            'Need Visuals'      : 'status-pill status-pill-vis',
            'Client Review'     : 'status-pill status-pill-rev',
            'WordPress Drafting': 'status-pill status-pill-wp-dft',
            'Scheduled'         : 'status-pill status-pill-sched',
            'Published'         : 'status-pill status-pill-pub'
        };
        return articleStageMap[statusValue] || 'status-pill';
    }
    
    // Social Media Post status values
    const socialStatusMap = {
        'Work In Progress': 'status-pill status-pill-wip',
        'Ready for Client': 'status-pill status-pill-ready',
        'Client Approved': 'status-pill status-pill-approved',
        'Revisions': 'status-pill status-pill-revisions',
        'Scheduled': 'status-pill status-pill-scheduled'
    };
    return socialStatusMap[statusValue] || 'status-pill';
}

function enrichRecord(r) {
    const isArticle     = r.objectType === 'Article';
    const isSocialMedia = r.objectType === 'SocialMediaPost';
    const pill          = isArticle ? (DATE_PILL[r.dateFieldLabel] || {}) : {};
    const approval      = isSocialMedia ? approvalMeta(r.clientApproved) : {};
    const statusPill    = isArticle ? statusPillClass(r.status, 'Article') : statusPillClass(r.status, 'SocialMediaPost');

    return {
        ...r,
        isArticle,
        isSocialMedia,
        tileClass:      `record-tile ${r.objectType.toLowerCase()}-tile`,
        badgeClass:     `object-badge ${r.objectType.toLowerCase()}-badge`,
        shortDateLabel: pill.short || '',
        datePillClass:  pill.cls   || '',
        statusPillClass: statusPill,
        tileStatusLabel: statusShorthand(r.status, r.objectType),
        formattedDate:  fmtDisplay(r.dateValue),
        briefDueDateFormatted:   r.briefDueDate   ? fmtDisplay(r.briefDueDate)   : '—',
        writingDueDateFormatted: r.writingDueDate ? fmtDisplay(r.writingDueDate) : '—',
        publishingDateFormatted: r.publishingDate ? fmtDisplay(r.publishingDate) : '—',
        approvalLabel:  approval.label || '',
        approvalStyle:  (approval.style || '') + 'display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;margin-top:8px;'
    };
}

// ── Component ──────────────────────────────────────────────────────────────
export default class CalendarView extends NavigationMixin(LightningElement) {

    // Automatically populated by the record page with the Marketing_Engagement__c Id
    @api   recordId;
    @api   componentKey;

    @track viewMode   = 'monthly';
    @track _year;
    @track _month;
    @track _weekStart;
    @track startDate;
    @track endDate;
    @track allRecords  = [];
    @track error       = null;
    @track hoveredRecord  = null;
    @track hoverStyle     = '';
    @track selectedRecord = null;
    
    _wiredRecordsResult;

    dayNames = DAY_NAMES;

    // ── Lifecycle ─────────────────────────────────────────────────────────
    connectedCallback() {
        const today     = new Date();
        this._year      = today.getFullYear();
        this._month     = today.getMonth();
        this._weekStart = weekStartOf(today);
        this._updateDateRange();
    }

    // ── Wire ──────────────────────────────────────────────────────────────
    @wire(getRecords, { startDate: '$startDate', endDate: '$endDate', marketingEngagementId: '$recordId' })
    wiredRecords(result) {
        this._wiredRecordsResult = result;
        const { error, data } = result;
        if (data) {
            this.allRecords = data;
            this.error      = null;
        } else if (error) {
            this.error      = error;
            this.allRecords = [];
            console.error('CalendarView – Apex error', error);
        }
    }

    // ── Header label ──────────────────────────────────────────────────────
    get currentPeriodLabel() {
        if (this.viewMode === 'monthly') {
            return `${MONTH_NAMES[this._month]} ${this._year}`;
        }
        if (!this._weekStart) return '';
        const ws = new Date(this._weekStart);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        if (ws.getMonth() === we.getMonth()) {
            return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${we.getFullYear()}`;
        }
        return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} – ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}, ${we.getFullYear()}`;
    }

    get monthButtonVariant() { return this.viewMode === 'monthly' ? 'brand' : 'neutral'; }
    get weekButtonVariant()  { return this.viewMode === 'weekly'  ? 'brand' : 'neutral'; }

    // ── Calendar grid ─────────────────────────────────────────────────────
    get calendarDays() {
        if (!this.startDate || !this.endDate) return [];

        const todayStr   = fmtISO(new Date());
        const maxVisible = this.viewMode === 'monthly' ? MAX_VISIBLE_MONTHLY : MAX_VISIBLE_WEEKLY;
        const days       = [];
        const current    = new Date(this.startDate);
        const end        = new Date(this.endDate);

        while (current <= end) {
            const dateStr = fmtISO(current);
            const recs    = (this.allRecords || [])
                .filter(r => r.dateValue === dateStr)
                .map(enrichRecord);

            const isCurrentMonth = current.getMonth() === this._month;
            const isToday        = dateStr === todayStr;
            const moreCount      = Math.max(0, recs.length - maxVisible);
            
            // Dynamic font sizing based on total record count
            const totalCount = recs.length;
            let fontSize = '11px';
            if (totalCount > 5) fontSize = '9px';
            else if (totalCount > 4) fontSize = '10px';

            days.push({
                key:       dateStr,
                dateStr,
                dayNumber: current.getDate(),
                records:   recs.slice(0, maxVisible),
                hasMore:   moreCount > 0,
                moreCount,
                recordsStyle: `font-size: ${fontSize}`,
                cellClass: [
                    'calendar-cell',
                    (!isCurrentMonth && this.viewMode === 'monthly') ? 'other-month' : '',
                    isToday ? 'today' : ''
                ].filter(Boolean).join(' ')
            });

            current.setDate(current.getDate() + 1);
        }
        return days;
    }

    // ── Navigation ────────────────────────────────────────────────────────
    handlePrev() {
        if (this.viewMode === 'monthly') {
            if (this._month === 0) { this._month = 11; this._year--; }
            else { this._month--; }
        } else {
            const d = new Date(this._weekStart);
            d.setDate(d.getDate() - 7);
            this._weekStart = d;
        }
        this._updateDateRange();
    }

    handleNext() {
        if (this.viewMode === 'monthly') {
            if (this._month === 11) { this._month = 0; this._year++; }
            else { this._month++; }
        } else {
            const d = new Date(this._weekStart);
            d.setDate(d.getDate() + 7);
            this._weekStart = d;
        }
        this._updateDateRange();
    }

    handleToday() {
        const today     = new Date();
        this._year      = today.getFullYear();
        this._month     = today.getMonth();
        this._weekStart = weekStartOf(today);
        this._updateDateRange();
    }

    async handleRefresh() {
        if (this._wiredRecordsResult) {
            await refreshApex(this._wiredRecordsResult);
        }
    }

    handleMonthView() { this.viewMode = 'monthly'; this._updateDateRange(); }
    handleWeekView()  { this.viewMode = 'weekly';  this._updateDateRange(); }

    // ── Record interaction ────────────────────────────────────────────────
    handleRecordHover(event) {
        const id     = event.currentTarget.dataset.id;
        const record = (this.allRecords || []).find(r => r.id === id);
        if (!record) return;

        const tileRect      = event.currentTarget.getBoundingClientRect();
        const containerRect = this.template.querySelector('.calendar-container').getBoundingClientRect();

        let top  = tileRect.bottom - containerRect.top + 6;
        let left = tileRect.left   - containerRect.left;
        const CARD_WIDTH = 272;
        if (left + CARD_WIDTH > containerRect.width - 8) {
            left = containerRect.width - CARD_WIDTH - 8;
        }

        this.hoverStyle    = `top:${top}px; left:${left}px;`;
        this.hoveredRecord = enrichRecord(record);
    }

    handleRecordLeave()  { this.hoveredRecord = null; }

    handleRecordClick(event) {
        event.stopPropagation();
        const id     = event.currentTarget.dataset.id;
        const record = (this.allRecords || []).find(r => r.id === id);
        if (!record) return;
        this.hoveredRecord  = null;
        this.selectedRecord = enrichRecord(record);
    }

    closeModal()  { this.selectedRecord = null; }

    openRecord() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.selectedRecord.id, actionName: 'view' }
        });
        this.selectedRecord = null;
    }

    // ── Private helpers ───────────────────────────────────────────────────
    _updateDateRange() {
        if (this.viewMode === 'monthly') {
            const firstOfMonth = new Date(this._year, this._month, 1);
            const gridStart    = new Date(firstOfMonth);
            gridStart.setDate(gridStart.getDate() - gridStart.getDay());
            const lastOfMonth  = new Date(this._year, this._month + 1, 0);
            const gridEnd      = new Date(lastOfMonth);
            gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
            this.startDate = fmtISO(gridStart);
            this.endDate   = fmtISO(gridEnd);
        } else {
            const ws = new Date(this._weekStart);
            const we = new Date(ws);
            we.setDate(we.getDate() + 6);
            this.startDate = fmtISO(ws);
            this.endDate   = fmtISO(we);
        }
    }
}