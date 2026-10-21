'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useThree } from '@react-three/fiber'

export type QualityTier = 'max' | 'balanced' | 'performance'

/**
 * Auto-detects device capability, monitors FPS, and adjusts quality dynamically.
 */
export function useQualityManager() {
  // Detected once on the client; this hook only runs inside an R3F Canvas, which never renders on the server.
  const [tier, setTier] = useState<QualityTier>(() => (typeof window === 'undefined' ? 'max' : detectQualityTier()))
  const [fps, setFps] = useState(60)
  const [autoAdjust, setAutoAdjust] = useState(false)
  const frameCountRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)
  const lowFpsCountRef = useRef(0)
  const highFpsCountRef = useRef(0)


  // FPS tracking
  const trackFrame = useCallback(() => {
    frameCountRef.current++
    const now = performance.now()
    if (lastTimeRef.current === null) lastTimeRef.current = now
    const elapsed = now - lastTimeRef.current

    if (elapsed >= 1000) {
      const currentFps = Math.round((frameCountRef.current / elapsed) * 1000)
      setFps(currentFps)
      frameCountRef.current = 0
      lastTimeRef.current = now

      // Auto-adjust quality based on FPS
      if (autoAdjust) {
        if (currentFps < 30) {
          lowFpsCountRef.current++
          highFpsCountRef.current = 0
          if (lowFpsCountRef.current >= 3) { // 3 consecutive seconds of low FPS
            setTier(prev => {
              if (prev === 'max') return 'balanced'
              if (prev === 'balanced') return 'performance'
              return prev
            })
            lowFpsCountRef.current = 0
          }
        } else if (currentFps > 55) {
          highFpsCountRef.current++
          lowFpsCountRef.current = 0
          if (highFpsCountRef.current >= 5) { // 5 consecutive seconds of high FPS
            setTier(prev => {
              if (prev === 'performance') return 'balanced'
              if (prev === 'balanced') return 'max'
              return prev
            })
            highFpsCountRef.current = 0
          }
        } else {
          lowFpsCountRef.current = 0
          highFpsCountRef.current = 0
        }
      }
    }
  }, [autoAdjust])

  return {
    tier,
    setTier,
    fps,
    trackFrame,
    autoAdjust,
    setAutoAdjust,
  }
}

function detectQualityTier(): QualityTier {
  if (typeof window === 'undefined') return 'balanced'

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return 'performance'

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = debugInfo
      ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string)
      : ''

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

    // High-end GPU patterns
    const isHighEnd = /RTX\s*[3-5]0|RX\s*[6-7]\d00|Apple\s*M[2-9]|Arc\s*A[5-9]|GeForce\s*GTX\s*1[6-9]|Radeon\s*RX\s*[5-7]/i.test(renderer)

    if (isMobile) return 'performance'
    if (isHighEnd) return 'max'
    return 'balanced'
  } catch {
    return 'balanced'
  }
}
