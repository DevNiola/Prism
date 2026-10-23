use criterion::{black_box, criterion_group, criterion_main, Criterion};
use grat_core::{xdr::codec::XdrCodec, MultiOpDecoder};
use serde_json::Value;
use stellar_xdr::curr::{
    Hash, HostFunction, InvokeContractArgs, InvokeHostFunctionOp, InvokeHostFunctionResult, Memo,
    MuxedAccount, Operation, OperationBody, OperationResult, OperationResultTr, Preconditions,
    ScAddress, ScSymbol, ScVal, SequenceNumber, Transaction, TransactionEnvelope, TransactionExt,
    TransactionResult, TransactionResultExt, TransactionResultResult, TransactionV1Envelope,
    Uint256, VecM,
};

fn transaction_data(operation_count: usize) -> Value {
    let operations: Vec<Operation> = (0..operation_count)
        .map(|_| Operation {
            source_account: None,
            body: OperationBody::InvokeHostFunction(InvokeHostFunctionOp {
                host_function: HostFunction::InvokeContract(InvokeContractArgs {
                    contract_address: ScAddress::Contract(Hash([2; 32])),
                    function_name: ScSymbol("benchmark".try_into().expect("valid symbol")),
                    args: vec![ScVal::U32(42)].try_into().expect("bounded args"),
                }),
                auth: VecM::default(),
            }),
        })
        .collect();
    let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
        tx: Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([1; 32])),
            fee: 200,
            seq_num: SequenceNumber(42),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: operations.try_into().expect("bounded operations"),
            ext: TransactionExt::V0,
        },
        signatures: VecM::default(),
    });
    let results: Vec<OperationResult> = (0..operation_count)
        .map(|_| {
            OperationResult::OpInner(OperationResultTr::InvokeHostFunction(
                InvokeHostFunctionResult::Success(Hash([0; 32])),
            ))
        })
        .collect();
    let result = TransactionResult {
        fee_charged: 150,
        result: TransactionResultResult::TxSuccess(
            results.try_into().expect("bounded operation results"),
        ),
        ext: TransactionResultExt::V0,
    };

    serde_json::json!({
        "envelopeXdr": envelope.to_xdr_base64().expect("encode envelope"),
        "resultXdr": result.to_xdr_base64().expect("encode result"),
    })
}

fn bench_decode_pipeline(criterion: &mut Criterion) {
    let decoder = MultiOpDecoder::new();
    let single_operation = transaction_data(1);
    let ten_operations = transaction_data(10);

    criterion.bench_function("decode_pipeline/one_operation", |bencher| {
        bencher.iter(|| {
            decoder
                .decode_transaction(black_box(&single_operation))
                .expect("decode transaction")
        });
    });
    criterion.bench_function("decode_pipeline/ten_operations", |bencher| {
        bencher.iter(|| {
            decoder
                .decode_transaction(black_box(&ten_operations))
                .expect("decode transaction")
        });
    });
}

criterion_group!(benches, bench_decode_pipeline);
criterion_main!(benches);
