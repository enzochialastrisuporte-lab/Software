import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const state = { session: null }

const authScreen = document.getElementById('auth-screen')
const appRoot = document.getElementById('app')
const authMessage = document.getElementById('auth-message')

// LOGIN
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  authMessage.textContent = 'Entrando...'

  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    authMessage.textContent = error.message
    return
  }

  state.session = data.user
  startApp()
})

// REGISTER
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  authMessage.textContent = 'Criando conta...'

  const email = document.getElementById('register-email').value.trim()
  const password = document.getElementById('register-password').value

  const { error } = await supabase.auth.signUp({
    email,
    password
  })

  authMessage.textContent = error ? error.message : 'Conta criada com sucesso!'
})

function startApp() {
  authScreen.classList.add('hidden')
  appRoot.classList.remove('hidden')

  document.getElementById('welcome-title').textContent =
    `Bem-vindo ${state.session?.email}`
}

// SESSION
async function checkSession() {
  const { data } = await supabase.auth.getUser()

  if (data?.user) {
    state.session = data.user
    startApp()
  }
}

// LOGOUT
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut()
  location.reload()
})

checkSession()
