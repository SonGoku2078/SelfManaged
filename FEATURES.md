# SelfManaged Features Documentation

## Implemented Features

### 1. Sidebar Navigation
- **Location**: Left side, dark background (#2d2d2d)
- **Items**:
  - Priorität (Priority view)
  - Inbox (All tasks)
  - Projekte (Projects)
  - Kategorien (Categories)
  - Kalender (Calendar)
  - Vorlagen (Templates)
  - Sie + Team (Team)
  - Suchen (Search)
  - Einstellungen (Settings)
  - Neuigkeiten (News)
- **Status**: ✅ Functional UI only (click handlers pending)

### 2. Calendar Panel
- **Location**: Middle section
- **Features**:
  - Mini calendar view (current month: June 2026)
  - Month/year selector dropdown
  - Weekday labels (Mo, Di, Mi, Do, Fr, Sa, So)
  - Full calendar grid (42 days = 6 weeks)
  - Current day highlighting (green)
  - Current week highlighting (green background on dates 15-21)
  - Previous/next month graying out
  - "Diese Woche" (This Week) button
- **Status**: ✅ Full UI implementation with logic

### 3. Task Management

#### Task Display
- **Checkbox**: Toggle task completion
- **Title**: Task name (truncated if long)
- **Metadata Display**:
  - Due date with time (e.g., "4. Juli, 14:40")
  - Priority indicator (red dot for high priority)
  - Project badge (currently showing "📌 1")
  - Task comment count
- **Star System**: Favorite/unfavorite tasks
- **Status**: ✅ Fully functional

#### Task Operations
- **Create**: Not yet implemented in UI
- **Read**: ✅ Display all tasks in list
- **Update**: Partial (detail panel exists, but updates don't fully persist)
- **Delete**: ✅ Available in detail panel
- **Toggle**: ✅ Check/uncheck tasks with visual feedback
- **Star**: ✅ Mark as favorite

### 4. Task Detail Panel
- **Trigger**: Click any task in list
- **Fields**:
  - Title (editable text input)
  - Description (editable textarea)
  - Due Date (date picker)
  - Priority (dropdown: Low, Medium, High)
  - Recurrence (dropdown: None, Daily, Weekly, Monthly)
  - Tags (comma-separated input)
- **Actions**:
  - Save button
  - Delete button
  - Close button (✕)
- **Status**: ✅ UI complete, backend integration pending

### 5. State Management (Zustand)

#### Store Structure
```typescript
interface AppState {
  tasks: Task[]
  uiState: UIState
  
  // Actions
  addTask(task: Task): void
  updateTask(id, updates): void
  deleteTask(id): void
  toggleTask(id): void
  toggleStar(id): void
  selectTask(task | null): void
  selectProject(projectId | null): void
  setCurrentView(view): void
  setCurrentDate(date): void
}
```

#### Implemented Actions
- ✅ `addTask` - Add new task to store
- ✅ `updateTask` - Update task properties
- ✅ `deleteTask` - Remove task from store
- ✅ `toggleTask` - Mark complete/incomplete
- ✅ `toggleStar` - Mark as favorite
- ✅ `selectTask` - Open detail panel
- ⏳ Other UI actions defined but unused

### 6. Dummy Data

#### Data Generation
- **Amount**: 20+ sample tasks
- **Randomization**:
  - Random titles from predefined list
  - Random due dates (±10 days from today)
  - Random priorities (low, medium, high)
  - Random projects
  - Random tags
  - Random starred status
  - Some tasks pre-completed
- **Auto-load**: Tasks load on app mount via useEffect
- **Status**: ✅ Fully working

### 7. Styling & UI

#### Design System
- **Primary Color**: Green (#4caf50)
- **Sidebar**: Dark gray (#2d2d2d)
- **Calendar Panel**: Darker gray (#3a3a3a)
- **Main Background**: White
- **Text Primary**: Dark gray (#1a1a1a)
- **Text Secondary**: Medium gray (#999999)
- **Border**: Light gray (#e0e0e0)
- **Alert**: Red (#ef4444)

#### Responsive Features
- ✅ Flexbox layout
- ✅ Hover effects on interactive elements
- ✅ Smooth transitions
- ✅ Visual feedback for actions
- ✅ Dark scrollbars in task list

### 8. Keyboard Shortcuts
- **Not yet implemented**
- Planned: j/k for navigation, space to toggle, etc.

## Not Yet Implemented

### High Priority
- [ ] Task creation from UI ("Add Task" button)
- [ ] Calendar date click → create task
- [ ] Repeating task execution logic
- [ ] Task persistence to localStorage
- [ ] Task filtering by calendar date

### Medium Priority
- [ ] Drag-and-drop task reordering
- [ ] Search functionality
- [ ] Advanced filters (by project, tag, priority)
- [ ] Keyboard shortcuts
- [ ] Undo/redo system

### Lower Priority
- [ ] Dark mode
- [ ] Team collaboration
- [ ] Time tracking
- [ ] Subtasks
- [ ] Task dependencies
- [ ] Custom tags/categories CRUD
- [ ] Export (PDF, iCal, etc.)
- [ ] Mobile app (React Native)

## Component API

### Sidebar Component
```tsx
interface SidebarProps {
  projects?: any[]
}
<Sidebar projects={projects} />
```

### CalendarPanel Component
```tsx
<CalendarPanel />
// No props - uses Zustand store internally
// Updates: currentDate, currentView
```

### TaskList Component
```tsx
interface TaskListProps {
  tasks: Task[]
  onSelectTask: (task: Task | null) => void
}
<TaskList tasks={tasks} onSelectTask={selectTask} />
```

### TaskDetailPanel Component
```tsx
interface TaskDetailPanelProps {
  task: Task
}
<TaskDetailPanel task={uiState.selectedTask} />
```

## Store Actions Usage

```tsx
// Get store instance
const store = useStore()

// Add task
store.addTask(newTask)

// Update task
store.updateTask('task-id', { title: 'New Title' })

// Delete task
store.deleteTask('task-id')

// Toggle completion
store.toggleTask('task-id')

// Toggle star
store.toggleStar('task-id')

// Select task for detail panel
store.selectTask(taskObject)

// Clear selection
store.selectTask(null)
```

## Testing Checklist

### Working ✅
- [x] Task list renders with dummy data
- [x] Checkboxes toggle task completion visually
- [x] Stars toggle (visual only)
- [x] Calendar displays current month
- [x] Week highlighting works
- [x] Click task opens detail panel
- [x] Detail panel fields display correct values
- [x] Delete button removes tasks

### To Test
- [ ] Save changes from detail panel
- [ ] Create new tasks
- [ ] Filter by date/project
- [ ] Search functionality
- [ ] Keyboard navigation
- [ ] Mobile responsiveness
- [ ] localStorage persistence

## Performance Notes

- Current: ~20 tasks, renders instantly
- Expected to handle: 100+ tasks with virtualization
- No infinite scrolling yet (could be added for large lists)
- Calendar rendering: O(42) fixed (always 6 weeks)
