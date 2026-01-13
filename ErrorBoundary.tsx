import React from 'react'
type P = { children: React.ReactNode }
type S = { hasError: boolean; error?: any }
export default class ErrorBoundary extends React.Component<P,S>{
  constructor(p:P){ super(p); this.state = { hasError:false } }
  static getDerivedStateFromError(error:any){ return { hasError:true, error } }
  componentDidCatch(err:any, info:any){ console.error('ErrorBoundary caught', err, info) }
  render(){
    if(this.state.hasError){
      return <div style={{padding:24}}>
        <h2>Something went wrong.</h2>
        <pre style={{opacity:.7, whiteSpace:'pre-wrap'}}>{String(this.state.error)}</pre>
      </div>
    }
    return this.props.children as any
  }
}
