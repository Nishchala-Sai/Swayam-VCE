import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { createEvent, updateEvent, updateCapacity, getAllEvents, getEventById, deleteEvent } from './events.controller.js'
import { createSubEvent, updateSubEvent, deleteSubEvent, listSubEvents, updateSubEventCapacity, getEventAnalytics } from './subEvents.controller.js'
import { getAvailability } from './availability.controller.js'
import { autoGroup, listTeams } from './teams.controller.js'
import { exportAttendees } from './export.controller.js'
import { listRegistrations } from './registrationsList.controller.js'

const router = Router()

// EVENT_HEADs pass the role check; the controllers limit them to events they created (except creating new ones)
const staff = [requireAuth, requireRole(['ADMIN', 'EVENT_HEAD'])]

router.post('/', ...staff, createEvent)
router.patch('/:id/capacity', ...staff, updateCapacity)
router.get('/:id/analytics', ...staff, getEventAnalytics)
router.get('/:eventId/export', ...staff, exportAttendees)
router.get('/:eventId/registrations', ...staff, listRegistrations)
router.post('/:eventId/sub-events', ...staff, createSubEvent)
router.get('/:eventId/sub-events', listSubEvents)
router.patch('/:eventId/sub-events/:subEventId/capacity', ...staff, updateSubEventCapacity)
router.patch('/:eventId/sub-events/:subEventId', ...staff, updateSubEvent)
router.delete('/:eventId/sub-events/:subEventId', ...staff, deleteSubEvent)
router.delete('/:id', ...staff, deleteEvent)
router.patch('/:id', ...staff, updateEvent)
router.post('/:eventId/sub-events/:subEventId/auto-group', ...staff, autoGroup)
router.get('/:eventId/sub-events/:subEventId/teams', ...staff, listTeams)
router.get('/', getAllEvents)
router.get('/availability', getAvailability) // before /:id, which would otherwise match "availability"
router.get('/:id', getEventById)

export default router
