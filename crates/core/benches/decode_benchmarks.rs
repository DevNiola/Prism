use criterion::{black_box, criterion_group, criterion_main, Criterion};
use grat_core::decode::{
    argument_decoder::ArgumentDecoder,
    recursive_decoder::RecursiveTypeDecoder,
    scval_to_json::scval_to_json,
};
use stellar_xdr::curr::{
    ContractExecutable, ScContractInstance, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, ScVec,
    StringM,
};

fn sample_primitive_scval() -> ScVal {
    ScVal::I64(123_456_789_012)
}

fn sample_complex_map() -> ScVal {
    let entries = vec![
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("user_id".try_into().unwrap())),
            val: ScVal::U32(42),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("balance".try_into().unwrap())),
            val: ScVal::I128(stellar_xdr::curr::Int128Parts {
                hi: 0,
                lo: 1_000_000_000,
            }),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("active".try_into().unwrap())),
            val: ScVal::Bool(true),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("metadata".try_into().unwrap())),
            val: ScVal::String(ScString(StringM::try_from(b"Grat Soroban Debugger".to_vec()).unwrap())),
        },
    ];

    ScVal::Map(Some(ScMap(entries.try_into().unwrap())))
}

fn sample_contract_instance() -> ScVal {
    let map = ScMap(
        vec![
            ScMapEntry {
                key: ScVal::U32(1),
                val: ScVal::U32(100),
            },
            ScMapEntry {
                key: ScVal::String(ScString(StringM::try_from(b"key".to_vec()).unwrap())),
                val: ScVal::U32(200),
            },
        ]
        .try_into()
        .unwrap(),
    );

    ScVal::ContractInstance(ScContractInstance {
        executable: ContractExecutable::StellarAsset,
        storage: Some(map),
    })
}

fn sample_vec_scval() -> ScVal {
    let elements = vec![
        ScVal::U32(1),
        ScVal::U32(2),
        ScVal::U32(3),
        ScVal::U32(4),
        ScVal::U32(5),
    ];
    ScVal::Vec(Some(ScVec(elements.try_into().unwrap())))
}

fn bench_scval_to_json(c: &mut Criterion) {
    let mut group = c.benchmark_group("scval_decode_pipeline");

    let primitive = sample_primitive_scval();
    group.bench_function("primitive_i64_decode", |b| {
        b.iter(|| {
            let res = scval_to_json(black_box(&primitive));
            black_box(res);
        })
    });

    let map = sample_complex_map();
    group.bench_function("complex_map_decode", |b| {
        b.iter(|| {
            let res = scval_to_json(black_box(&map));
            black_box(res);
        })
    });

    let instance = sample_contract_instance();
    group.bench_function("contract_instance_decode", |b| {
        b.iter(|| {
            let res = scval_to_json(black_box(&instance));
            black_box(res);
        })
    });

    let vec_val = sample_vec_scval();
    group.bench_function("scvec_decode", |b| {
        b.iter(|| {
            let res = scval_to_json(black_box(&vec_val));
            black_box(res);
        })
    });

    group.finish();
}

fn bench_structural_decoders(c: &mut Criterion) {
    let mut group = c.benchmark_group("structural_decoders");

    let arg_decoder = ArgumentDecoder::new();
    let args = vec![sample_primitive_scval(), sample_complex_map(), sample_vec_scval()];
    group.bench_function("argument_decoder_dynamic", |b| {
        b.iter(|| {
            let res = arg_decoder.decode_dynamic(black_box(&args));
            black_box(res);
        })
    });

    let recursive_decoder = RecursiveTypeDecoder::new();
    let map = sample_complex_map();
    group.bench_function("recursive_decoder_evaluation", |b| {
        b.iter(|| {
            let res = recursive_decoder.decode(black_box(&map), None);
            black_box(res);
        })
    });

    group.finish();
}

criterion_group!(benches, bench_scval_to_json, bench_structural_decoders);
criterion_main!(benches);
