'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

interface WorkoutStarterProps {
  userId: string
  userProgramId: string | null
  currentPhaseId: string | null
  currentPhaseName: string | null
}

export function WorkoutStarter({
  userId,
  userProgramId,
  currentPhaseId,
  currentPhaseName,
}: WorkoutStarterProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleStart() {
    setLoading(true)
    const res = await fetch('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        phase_id: currentPhaseId,
        user_program_id: userProgramId,
        status: 'in_progress',
      }),
    })
    if (res.ok) {
      const { session } = await res.json()
      router.push(`/workouts/${session.id}`)
    } else {
      setLoading(false)
    }
  }

  return (
    <Card accent="herb">
      <CardBody>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-ink">Bắt đầu buổi tập hôm nay</p>
            <p className="text-sm text-ink/50 mt-0.5">
              {currentPhaseName
                ? `Giai đoạn hiện tại: ${currentPhaseName}`
                : 'Không có chương trình kích hoạt — bạn vẫn có thể ghi nhật ký buổi tập tự do'}
            </p>
          </div>
          <Button onClick={handleStart} loading={loading} variant="herb">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Bắt đầu tập
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
