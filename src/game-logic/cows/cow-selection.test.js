import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { farmhandStub } from '../../test-utils/stubs/farmhandStub'
import { generateCow, getCowDisplayName } from '../../utils'
import { stageFocusType } from '../../enums'

describe('cow selection', () => {
  let cowDisplayName1 = null
  let cowDisplayName2 = null
  let cow1 = null
  let cow2 = null

  beforeEach(async () => {
    jest.useFakeTimers()

    const cowId1 = 'foo'
    const cowId2 = 'bar'
    const cowStub1 = generateCow({ id: cowId1 })
    const cowStub2 = generateCow({ id: cowId2 })

    await farmhandStub({
      cowInventory: [cowStub1, cowStub2],
      stageFocus: stageFocusType.COW_PEN,
      purchasedCowPen: 1,
    })

    cowDisplayName1 = getCowDisplayName(cowStub1, cowId1, false)
    cowDisplayName2 = getCowDisplayName(cowStub2, cowId1, false)
    cow1 = (await screen.findByAltText(cowDisplayName1)).closest('.cow')
    cow2 = (await screen.findByAltText(cowDisplayName2)).closest('.cow')
  })

  afterEach(() => {
    // Allow all cow movement timers to expire
    act(() => {
      jest.advanceTimersByTime(2000)
    })
  })

  test('no cows are selected by default', () => {
    expect(screen.queryByText('is selected')).not.toBeInTheDocument()
  })

  test('a cow can be selected', () => {
    userEvent.click(cow1)

    act(() => {
      // Prevent async update warning from Popper.js (used by Material UI
      // tooltips). See "Case 2" here:
      // https://davidwcai.medium.com/react-testing-library-and-the-not-wrapped-in-act-errors-491a5629193b
      jest.advanceTimersByTime(200)
    })

    expect(
      screen.queryByText(`${cowDisplayName1} is selected`)
    ).toBeInTheDocument()
  })

  test('selecting another cow deselects the first one', () => {
    userEvent.click(cow1)

    act(() => {
      jest.advanceTimersByTime(200)
    })

    userEvent.click(cow2)

    act(() => {
      jest.advanceTimersByTime(200)
    })

    expect(
      screen.queryByText(`${cowDisplayName1} is selected`)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(`${cowDisplayName2} is selected`)
    ).toBeInTheDocument()
  })

  test('changing views deselects all cows', async () => {
    userEvent.click(cow1)

    act(() => {
      jest.advanceTimersByTime(200)
    })

    const previousViewButton = await screen.findByLabelText('Previous view')
    const nextViewButton = await screen.findByLabelText('Next view')

    userEvent.click(previousViewButton)
    userEvent.click(nextViewButton)

    expect(screen.queryByText('is selected')).not.toBeInTheDocument()
  })
})
