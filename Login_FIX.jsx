import { useState } from 'react'
import { supabase } from './lib_supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    try {
      setLoading(true)

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: senha
      })

      if (error) throw error

      window.location.href = '/dashboard'

    } catch (err) {
      console.error(err)
      alert('Email ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <input placeholder="Email" onChange={(e)=>setEmail(e.target.value)} />
      <input placeholder="Senha" type="password" onChange={(e)=>setSenha(e.target.value)} />
      <button onClick={handleLogin}>
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </div>
  )
}
