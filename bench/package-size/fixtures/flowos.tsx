// A small dashboard supplied by the user (2026-10-27) as an emitted-size check:
// sources, Group/suspend, lists of components, forms, refs, effects and a timer.
import { mount } from '@memoized-dom/runtime'
import { Group, $fetch, $read, $track } from '@memoized-dom/data'

type Todo = { id: number; title: string; done: boolean; priority: 'low' | 'high' }
type Expense = { id: number; label: string; amount: number; category: string }
type Note = { id: number; title: string; body: string }

async function loadTodos(): Promise<Todo[]> {
  await new Promise(r => setTimeout(r, 10))
  return [
    { id: 1, title: 'Ship portfolio v2', done: false, priority: 'high' },
    { id: 2, title: 'Gym - legs', done: false, priority: 'low' },
    { id: 3, title: 'Review budget', done: true, priority: 'high' },
  ]
}

async function loadExpenses(): Promise<Expense[]> {
  await new Promise(r => setTimeout(r, 10))
  return [
    { id: 1, label: 'Data bundle', amount: 120, category: 'Bills' },
    { id: 2, label: 'Food', amount: 85, category: 'Food' },
    { id: 3, label: 'Transport', amount: 60, category: 'Transport' },
  ]
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div class="stat">
      <span class="stat-value">{value}</span>
      <span class="stat-label">{label}</span>
    </div>
  )
}

function TaskRow({ todo, onToggle, onDelete }: {
  todo: Todo
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <li class={todo.done ? 'row done' : 'row'}>
      <input type="checkbox" checked={todo.done} onChange={onToggle} />
      <span>{todo.title}</span>
      {todo.priority === 'high' && <b class="badge">HIGH</b>}
      <button onClick={onDelete}>×</button>
    </li>
  )
}

export function App() {
  let tab: 'dashboard' | 'tasks' | 'money' | 'notes' | 'focus' = 'dashboard'
  let taskFilter: 'all' | 'active' | 'done' = 'all'
  let moneyFilter = 'All'
  let newTask = ''
  let newExpenseLabel = ''
  let newExpenseAmount = ''
  let newNoteTitle = ''
  let search = ''

  let searchEl: HTMLInputElement | undefined

  const todos = $read(loadTodos())
  const expenses = $read(loadExpenses())

  const quote = $fetch<{ content: string; author: string }>(
    'https://api.quotable.io/random'
  )

  const todosReq = $track(todos)

  let doneCount = 0
  let activeCount = 0
  for (const t of todos) {
    if (t.done) doneCount++
    else activeCount++
  }

  let totalSpent = 0
  for (const e of expenses) totalSpent += e.amount

  let filteredTodos = todos
  if (taskFilter === 'active') filteredTodos = todos.filter(t => !t.done)
  if (taskFilter === 'done') filteredTodos = todos.filter(t => t.done)

  let filteredExpenses = expenses
  if (moneyFilter !== 'All') {
    filteredExpenses = expenses.filter(e => e.category === moneyFilter)
  }

  let notes: Note[] = [
    { id: 1, title: 'Idea', body: 'Build a dashboard that feels like a game' },
  ]
  let visibleNotes = notes
  if (search) {
    const q = search.toLowerCase()
    visibleNotes = notes.filter(n =>
      n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    )
  }

  let secondsLeft = 25 * 60
  let isRunning = false
  let mode: 'focus' | 'break' = 'focus'

  const timerId = setInterval(() => {
    if (!isRunning) return
    secondsLeft--
    if (secondsLeft <= 0) {
      isRunning = false
      mode = mode === 'focus' ? 'break' : 'focus'
      secondsLeft = mode === 'focus' ? 25  *60 : 5*  60
    }
  }, 1000)

  $cleanup(() => clearInterval(timerId))

  $effect(() => {
    document.title = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')} - ${mode} | FlowOS`
    return () => { document.title = 'FlowOS' }
  })

  let mins = Math.floor(secondsLeft / 60)
  let secs = secondsLeft % 60

  function addTask(e: Event) {
    e.preventDefault()
    if (!newTask.trim()) return
    todos.push({ id: Date.now(), title: newTask, done: false, priority: 'low' })
    newTask = ''
  }

  return (
    <Group
      pending={() => <p class="loading">Loading your day…</p>}
      error={({ error, retry }) => <button onClick={retry}>Retry - {error.message}</button>}
    >
      <div class="app">
        <header>
          <h1>FlowOS</h1>
          <input
            ref={searchEl}
            placeholder="Search notes…"
            value={search}
            onInput={(e) => search = (e.target as HTMLInputElement).value}
          />
          <button onClick={() => searchEl?.focus()}>Focus search</button>
        </header>

        <nav>
          {(['dashboard', 'tasks', 'money', 'notes', 'focus'] as const).map(t => (
            <button
              key={t}
              class={tab === t ? 'active' : ''}
              onClick={() => tab = t}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === 'dashboard' && (
          <section suspend>
            <div class="stats">
              <Stat label="Active tasks" value={activeCount} />
              <Stat label="Done" value={doneCount} />
              <Stat label="Total spent" value={`$${totalSpent}`} />
            </div>
            <blockquote>
              "{quote.content}" <cite>- {quote.author}</cite>
            </blockquote>
            <p>{todosReq.refreshing ? 'Syncing…' : 'Up to date'}</p>
            <button onClick={() => todosReq.refresh()}>Refresh tasks</button>
            {todosReq.error && <p>Error: {todosReq.error.message}</p>}
          </section>
        )}

        {tab === 'tasks' && (
          <section suspend>
            <form onSubmit={addTask}>
              <input value={newTask} onInput={(e) => newTask = (e.target as HTMLInputElement).value} placeholder="New task…" />
              <button type="submit">Add</button>
            </form>
            <div>
              <button onClick={() => taskFilter = 'all'}>All</button>
              <button onClick={() => taskFilter = 'active'}>Active ({activeCount})</button>
              <button onClick={() => taskFilter = 'done'}>Done ({doneCount})</button>
            </div>
            <ul>
              {filteredTodos.map(t => (
                <TaskRow
                  key={t.id}
                  todo={t}
                  onToggle={() => t.done = !t.done}
                  onDelete={() => {
                    const idx = todos.indexOf(t)
                    todos.splice(idx, 1)
                  }}
                />
              ))}
            </ul>
          </section>
        )}

        {tab === 'money' && (
          <section>
            <h3>Total: ${totalSpent}</h3>
            <select value={moneyFilter} onChange={(e) => moneyFilter = (e.target as HTMLSelectElement).value}>
              <option>All</option>
              <option>Food</option>
              <option>Bills</option>
              <option>Transport</option>
            </select>
            <form onSubmit={(e) => {
              e.preventDefault()
              expenses.push({ id: Date.now(), label: newExpenseLabel, amount: Number(newExpenseAmount) || 0, category: 'Food' })
              newExpenseLabel = ''; newExpenseAmount = ''
            }}>
              <input value={newExpenseLabel} onInput={(e) => newExpenseLabel = (e.target as HTMLInputElement).value} placeholder="Label" />
              <input value={newExpenseAmount} onInput={(e) => newExpenseAmount = (e.target as HTMLInputElement).value} placeholder="Amount" />
              <button>Add expense</button>
            </form>
            <ul>
              {filteredExpenses.map(e => <li key={e.id}>{e.label} - ${e.amount} <i>{e.category}</i></li>)}
            </ul>
          </section>
        )}

        {tab === 'notes' && (
          <section>
            <p>Showing {visibleNotes.length} notes</p>
            <ul>
              {visibleNotes.map(n => (
                <li key={n.id}>
                  <b>{n.title}</b>
                  <input value={n.body} onInput={(e) => n.body = (e.target as HTMLInputElement).value} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'focus' && (
          <section>
            <h2>{mode === 'focus' ? 'Focus' : 'Break'}</h2>
            <div class="timer">{mins}:{String(secs).padStart(2, '0')}</div>
            <button onClick={() => isRunning = !isRunning}>{isRunning ? 'Pause' : 'Start'}</button>
            <button onClick={() => { secondsLeft = 25 * 60; isRunning = false; mode = 'focus' }}>Reset</button>
          </section>
        )}
      </div>
    </Group>
  )
}
