import React from 'react'
import { createRoot } from 'react-dom/client'
import FirstReadingAdminPanel from '../../src/components/FirstReadingAdminPanel'
import { AuthStateContext, AuthActionsContext } from '../../src/providers/AuthProvider'
import '../../src/index.css'
let config={enabled:false,submissionA:null,submissionB:null,updatedAt:'fixture-0',items:[
 {id:'a',title:'The Art of Paying Attention',intro:'重新发现日常生活中被忽略的细节。',wordCount:640,available:true,status:'active'},
 {id:'b',title:'A Small Journey into the Unknown',intro:'一次意料之外的旅程。',wordCount:820,available:true,status:'active'},
]}
window.fetch=async(url,opts)=>{
 const name=String(url).split('/').pop()
 if(name==='admin_get_first_reading_config') return Response.json(config)
 if(name==='admin_save_first_reading_config') {
  const input=JSON.parse(opts.body)
  config={...config,enabled:input.p_enabled,submissionA:input.p_submission_a,submissionB:input.p_submission_b,updatedAt:'fixture-1'}
  return Response.json(config)
 }
 throw new Error('Unexpected external request blocked')
}
createRoot(document.getElementById('root')).render(<AuthStateContext.Provider value={{userId:'fixture-admin'}}><AuthActionsContext.Provider value={{refreshAuthState(){}}}><main style={{maxWidth:1000,margin:'40px auto',padding:24}}><FirstReadingAdminPanel /></main></AuthActionsContext.Provider></AuthStateContext.Provider>)
