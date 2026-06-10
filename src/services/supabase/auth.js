import { getSupabaseClient } from './client'

export async function getSession() {
  const { data, error } = await getSupabaseClient().auth.getSession()

  if (error) {
    throw error
  }

  return data.session
}

export async function signInWithPassword({ email, password }) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw error
  }

  return data
}

export async function signUpWithPassword({ email, password }) {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email,
    password,
  })

  if (error) {
    throw error
  }

  return data
}

export async function getCurrentUser() {
  const { data, error } = await getSupabaseClient().auth.getUser()

  if (error) {
    throw error
  }

  return data.user
}

export function subscribeToAuthStateChange(handler) {
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    handler(session)
  })

  return () => {
    data.subscription.unsubscribe()
  }
}

export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut()

  if (error) {
    throw error
  }
}
