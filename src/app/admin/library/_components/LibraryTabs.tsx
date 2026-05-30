'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { MovementPatternsTab } from './MovementPatternsTab'
import { ExercisesTab } from './ExercisesTab'
import type { MovementPattern, Exercise } from '@/types'

interface LibraryTabsProps {
  initialPatterns: MovementPattern[]
  initialExercises: Exercise[]
}

const TABS = [
  { id: 'exercises', label: 'Bài tập' },
  { id: 'patterns', label: 'Chuỗi Chuyển Động' },
]

export function LibraryTabs({ initialPatterns, initialExercises }: LibraryTabsProps) {
  const [activeTab, setActiveTab] = useState('exercises')
  const [patterns, setPatterns] = useState(initialPatterns)
  const [exercises, setExercises] = useState(initialExercises)

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-ink/8">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-ink text-ink'
                : 'border-transparent text-ink/45 hover:text-ink/70',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Nội dung */}
      {activeTab === 'exercises' && (
        <ExercisesTab
          exercises={exercises}
          patterns={patterns}
          onExercisesChange={setExercises}
        />
      )}
      {activeTab === 'patterns' && (
        <MovementPatternsTab
          patterns={patterns}
          onPatternsChange={setPatterns}
        />
      )}
    </div>
  )
}
