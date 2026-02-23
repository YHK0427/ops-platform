
import asyncio
from unittest.mock import MagicMock
from app.services.penalty_engine import PenaltyEngine, PenaltyItem

def test_milestone_logic():
    print("=== Milestone Logic Unit Test ===")
    
    # Mock dependencies
    mock_session = MagicMock()
    mock_db = MagicMock()
    engine = PenaltyEngine(mock_session, mock_db)
    
    test_cases = [
        # (before, after, expected_count, expected_desc)
        # 완료 조건 시나리오
        (-9, -11, 1, "누적벌점 -10점 도달"),   # -10점 돌파 -> True
        (-11, -12, 0, None),                # 이미 지남 -> False
        (-19, -21, 1, "누적벌점 -20점 도달"),  # -20점 돌파 -> True
        
        # 추가 검증
        (0, -5, 0, None),
        (-9, -10, 1, "누적벌점 -10점 도달"), # Exact match
        (-5, -25, 1, "누적벌점 -10점 도달"), # Multi-step jump (Current logic)
    ]
    
    for before, after, exp_cnt, exp_desc_part in test_cases:
        # check_milestone_after_update returns single item or None
        result = engine.check_milestone_after_update(before, after)
        
        if exp_cnt == 0:
            if result is None:
                print(f"[PASS] {before} -> {after}: No Penalty")
            else:
                print(f"[FAIL] {before} -> {after}: Expected None, got {result}")
        else:
            if result and exp_desc_part in result.description:
                print(f"[PASS] {before} -> {after}: {result.description} (Deposit: {result.deposit_delta})")
            else:
                print(f"[FAIL] {before} -> {after}: Expected '{exp_desc_part}', got {result}")

    # Multi-step handling check analysis
    print("\n--- Multi-step Analysis (-5 -> -25) ---")
    res = engine.check_milestone_after_update(-5, -25)
    print(f"Result: {res}")
    if res and res.description == "누적벌점 -10점 도달 추가 벌금":
        print("Note: Current logic returns ONLY the first threshold crossed (-10). -20 is ignored.")

if __name__ == "__main__":
    test_milestone_logic()
