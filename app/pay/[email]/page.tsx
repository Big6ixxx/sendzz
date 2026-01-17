'use client'
import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useState } from 'react'

export default function SendMoneyForm() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [])

  const handleSend = async () => {
    if (!user) {
      alert("Please log in first!")
      return
    }

    const response = await fetch('/api/send-usdc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'recipient@example.com',
        amount: 10
      }),
    })
    
    const data = await response.json()
    if (data.success) {
      alert("Money sent successfully!")
    } else {
      alert(`Error: ${data.error}`)
    }
  }

  return (
    <div>
      {user ? (
        <button onClick={handleSend}>Send USDC</button>
      ) : (
        <p>Please log in to send money.</p>
      )}
    </div>
  )
}