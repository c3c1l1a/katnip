import {createWhereClause} from "./db-util.js";
import FieldSpec from "./FieldSpec.js";

export default class Model {
	constructor(data={}) {
		let cls=this.constructor;

		for (let k in data)
			this[k]=data[k];
	}

	async refresh() {
		let cls=this.constructor;

		if (!this.getPrimaryKeyValue())
			throw new Error("Can't refresh, no PK value.");

		let o={};
		o[cls.getPrimaryKeyField()]=this.getPrimaryKeyValue();
		let q=createWhereClause(o);

		let qs=`SELECT * FROM ${cls.getTableName()} ${q.query}`;
		let dbRows=await cls.db.query(qs,q.vals);
		if (!dbRows.length)
			throw new Error("Can't refresh, doesn't exist");

		let dbRow=dbRows[0];

		for (let fieldName in cls.fields) {
			let fieldSpec=cls.getFieldSpec(fieldName);
			this[fieldName]=fieldSpec.hydrate(dbRow[fieldName]);
		}
	}

	static async findMany(params={}) {
		let cls=this;
		let q;

		if (typeof params=="object" && params)
			q=createWhereClause(params);

		else {
			let o={};
			o[cls.getPrimaryKeyField()]=params;
			q=createWhereClause(o);
		}

		let qs=`SELECT * FROM ${cls.getTableName()} ${q.query}`;
		let dbRows=await cls.db.query(qs,q.vals);

		let res=[];
		for (let dbRow of dbRows) {
			let o={};
			for (let fieldName in cls.fields) {
				let fieldSpec=cls.getFieldSpec(fieldName);
				o[fieldName]=fieldSpec.hydrate(dbRow[fieldName]);
			}
			res.push(new cls(o));
		}

		return res;
	}

	static async getAggregate(sql, whereParams={}) {
		let cls=this;
		let q=createWhereClause(whereParams);
		let qs=`SELECT ${sql} FROM ${cls.getTableName()} ${q.query}`;
		let dbRows=await cls.db.query(qs,q.vals);

		let firstKey=Object.keys(dbRows[0])[0];
		return dbRows[0][firstKey];
	}

	static async getCount(params={}) {
		return this.getAggregate("COUNT(*)",params);
	}

	static async findOne(params) {
		let res=await this.findMany(params);

		return res[0];
	}

    getUpsertSql() {
		let cls=this.constructor;
		let res={qs: "", vals: []};
		for (let fieldName in cls.fields) {
			if (!cls.isAutoIncrementPrimaryKey() ||
					fieldName!=cls.getPrimaryKeyField()) {
				if (res.qs)
					res.qs+=`,`;

				let fieldSpec=cls.fields[fieldName];
				res.qs+=`\`${fieldName}\`=?`;
				let spec=cls.getFieldSpec(fieldName);
				res.vals.push(spec.serialize(this[fieldName]));
			}
		}
		return res;
	}

	async insert() {
		let cls=this.constructor;
		let vq=[],names=[],vals=[];

		for (let fieldName in cls.fields) {
			if (!cls.isAutoIncrementPrimaryKey() ||
					fieldName!=cls.getPrimaryKeyField()) {
				vq.push("?");
				names.push(fieldName);

				let spec=cls.getFieldSpec(fieldName);
				vals.push(spec.serialize(this[fieldName]));
			}
		}

		let qs=`INSERT INTO ${cls.getTableName()} (${names.join(",")}) VALUES (${vq.join(",")})`;
		let res=await cls.db.query(qs,vals);

		if (cls.isAutoIncrementPrimaryKey() && res.insertId)
			this[cls.getPrimaryKeyField()]=res.insertId;
	}

	async update() {
		let cls=this.constructor;
		let upsert=this.getUpsertSql();
		let qs=`UPDATE ${cls.getTableName()} SET ${upsert.qs} WHERE ${cls.getPrimaryKeyField()}=?`;
		upsert.vals.push(this.getPrimaryKeyValue());
		let res=await cls.db.query(qs,upsert.vals);

		if (!res.affectedRows && !cls.isAutoIncrementPrimaryKey())
			await this.insert();
	}

	async save() {
		if (this.getPrimaryKeyValue())
			await this.update();

		else
			await this.insert();
	}

	async delete() {
		let id=this.getPrimaryKeyValue();
		if (!id)
			throw new Error("No PK value.");

		let cls=this.constructor;
		await cls.db.query(`DELETE FROM ${cls.getTableName()} WHERE ${cls.getPrimaryKeyField()}=?`,[id]);
	}

	static isAutoIncrementPrimaryKey() {
		let spec=this.getFieldSpec(this.getPrimaryKeyField())
		return spec.auto_increment;
	}

	getPrimaryKeyValue() {
		let cls=this.constructor;

		return this[cls.getPrimaryKeyField()];
	}

	static getTableName() {
		if (this.tableName)
			return this.tableName;

		//Let's support class name again, it is ok on the server, so the next
		//line should be commented out.
		//throw new Error("No tableName defined for: "+this.name);

		return this.name;
	}

	static getPrimaryKeyField() {
		if (!this.primaryKeyField) {
			for (let fieldId in this.fields)
				if (this.getFieldSpec(fieldId).primary_key)
					this.primaryKeyField=fieldId;
		}

		if (!this.primaryKeyField)
			throw new Error("No primary key field for "+this.getTableName());

		return this.primaryKeyField;
	}

	static getFieldSpec(fieldId) {
		if (!this.fieldSpecs)
			this.fieldSpecs={};

		if (!this.fieldSpecs[fieldId])
			this.fieldSpecs[fieldId]=FieldSpec.fromSqlDef(this.fields[fieldId]);

		return this.fieldSpecs[fieldId];
	}

	static async createTable(suffix="") {
		let cls=this;
		let qs=`CREATE TABLE ${cls.getTableName()+suffix} (`;

		let first=true;
		for (let fieldName in cls.fields) {
			if (!first)
				qs+=",";

			first=false;
			qs+=`\`${fieldName}\` ${cls.getFieldSpec(fieldName).getSql(this.db.getFlavour())}`;
		}

		qs+=")";

		await this.db.query(qs);
	}

	static checkDescribeResult(describeResult) {
		let current={};
		for (let fieldId in this.fields)
			current[fieldId]=FieldSpec.fromSqlDef(this.fields[fieldId]);

		let described={};
		for (let describeRow of describeResult)
			described[describeRow.Field]=FieldSpec.fromDescribeRow(describeRow);

		for (let k in current)
			if (!current[k].equals(described[k])) {
				//console.log("diff: "+k)
				return false;
			}

		for (let k in described)
			if (!described[k].equals(current[k])) {
				//console.log("diff: "+k)
				return false;
			}

		return true;
	}

	static async install() {
		this.getPrimaryKeyField();
		let describeResult=await this.db.describe(this.getTableName());

		// If it doesn't exist, just create it.
		if (!describeResult)
			return await this.createTable();

		// If it is up to date, don't do anything.
		if (this.checkDescribeResult(describeResult))
			return;

		// Create temporary table, first delete if exists.
		if (await this.db.describe(this.getTableName()+"_new"))
			await this.db.query(`DROP TABLE ${this.getTableName()+"_new"}`);

		await this.createTable("_new");

		// Copy data.
		//console.log("copying...");
		let n=this.getTableName();
		let describedNames=describeResult.map(o=>o.Field);
		let copyFields=Object.keys(this.fields).filter(value=>describedNames.includes(value));
		if (copyFields.length) {
			let copyS=copyFields.join(",");
			let sq=`INSERT INTO ${n+"_new"} (${copyS}) SELECT ${copyS} FROM ${n}`;
			await this.db.query(sq);
		}

		await this.db.query(`ALTER TABLE ${n} RENAME TO ${n+"_old"}`);
		await this.db.query(`ALTER TABLE ${n+"_new"} RENAME TO ${n}`);
		await this.db.query(`DROP TABLE ${n+"_old"}`);
	}
}
